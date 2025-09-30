use cosmwasm_std::{
    entry_point, coin, from_json, to_json_binary, Addr, BankMsg, Binary, Deps, DepsMut, Env,
    MessageInfo, Reply, Response, StdResult, Uint128, Coin, StdError, Empty,
};
use cw2::set_contract_version;
use cw721_base::{msg as cw721_msg, Cw721Contract};

use crate::error::ContractError;
use crate::msg::{
    ConfigResponse, CustomQueryMsg, ExecuteMsg, InstantiateMsg, Metadata, MintPriceResponse,
    SupplyResponse,
};
use crate::state::{Config, CONFIG, TOTAL_MINTED, MINTED_BY};

pub mod error;
pub mod msg;
pub mod state;

const CONTRACT_NAME: &str = "crates.io:cw721_public_mint";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

// -------------------- cw721 helper --------------------
fn cw<'a>() -> Cw721Contract<'a, Metadata, cosmwasm_std::Empty, cosmwasm_std::Empty, cosmwasm_std::Empty> {
    Cw721Contract::default()
}

// -------------------- instantiate --------------------
#[entry_point]
pub fn instantiate(
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    // cw721-base を内部に同居: minter=このコントラクト
    let cw_msg = cw721_msg::InstantiateMsg {
        name: msg.name.clone(),
        symbol: msg.symbol.clone(),
        minter: env.contract.address.to_string(),
    };
    cw().instantiate(deps.branch(), env.clone(), info.clone(), cw_msg)?;

    let admin = match msg.admin {
        Some(a) => deps.api.addr_validate(&a)?,
        None => info.sender.clone(),
    };

    let fee_recipient = match msg.fee_recipient {
        Some(a) if !a.is_empty() => Some(deps.api.addr_validate(&a)?),
        _ => None,
    };

    let cfg = Config {
        admin,
        public_mint_enabled: msg.public_mint_enabled.unwrap_or(true),
        mint_fee_denom: msg.mint_fee_denom.unwrap_or_default(),
        mint_fee_amount: msg.mint_fee_amount.unwrap_or_else(Uint128::zero),

        max_per_address: msg.max_per_address.unwrap_or(1),
        max_supply: msg.max_supply.unwrap_or(0),
        transfer_locked: msg.transfer_locked.unwrap_or(false),

        mint_start: msg.mint_start.unwrap_or(0),
        mint_end: msg.mint_end.unwrap_or(0),

        base_uri: msg.base_uri,
        placeholder_uri: msg.placeholder_uri,
        revealed: msg.revealed.unwrap_or(false),
        provenance_hash: msg.provenance_hash,

        fee_recipient,
        pending_admin: None,
    };
    CONFIG.save(deps.storage, &cfg)?;
    TOTAL_MINTED.save(deps.storage, &0)?;
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;

    Ok(Response::new()
        .add_attribute("action", "instantiate")
        .add_attribute("name", msg.name)
        .add_attribute("symbol", msg.symbol))
}

// -------------------- helpers --------------------
fn ensure_admin(cfg: &Config, sender: &Addr) -> Result<(), ContractError> {
    if &cfg.admin != sender {
        return Err(ContractError::Unauthorized);
    }
    Ok(())
}

fn check_time_window(cfg: &Config, env: &Env) -> Result<(), ContractError> {
    let now = env.block.time.seconds();
    if cfg.mint_start > 0 && now < cfg.mint_start {
        return Err(ContractError::MintNotOpen);
    }
    if cfg.mint_end > 0 && now >= cfg.mint_end {
        return Err(ContractError::MintNotOpen);
    }
    Ok(())
}

/// fee 検証と、必要なら **設定額のみ**を fee_recipient へ送金する BankMsg を返す
fn check_and_maybe_forward_fee(cfg: &Config, info: &MessageInfo) -> Result<Vec<BankMsg>, ContractError> {
    if cfg.mint_fee_denom.is_empty() || cfg.mint_fee_amount.is_zero() {
        return Ok(vec![]);
    }
    // 送金額（fee_denom のみ）を集計
    let paid = info
        .funds
        .iter()
        .filter(|c| c.denom == cfg.mint_fee_denom)
        .fold(Uint128::zero(), |acc, c| acc + c.amount);

    if paid < cfg.mint_fee_amount {
        return Err(ContractError::InsufficientMintFee);
    }
    if let Some(to) = &cfg.fee_recipient {
        // 設定額のみ送金（過剰入金はコントラクト残高に滞留）
        return Ok(vec![BankMsg::Send {
            to_address: to.to_string(),
            amount: vec![coin(cfg.mint_fee_amount.u128(), &cfg.mint_fee_denom)],
        }]);
    }
    Ok(vec![])
}

// -------------------- execute --------------------
#[entry_point]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: Binary,
) -> Result<Response, ContractError> {
    // まずは当コントラクトの ExecuteMsg を試す
    if let Ok(my) = from_json::<ExecuteMsg>(&msg) {
        return match my {
            ExecuteMsg::PublicMint { token_id, owner, token_uri, extension }
            | ExecuteMsg::Mint { token_id, owner, token_uri, extension } => {
                execute_public_mint(deps, env, info, token_id, owner, token_uri, extension)
            }

            ExecuteMsg::UpdateConfig {
                public_mint_enabled, mint_fee_denom, mint_fee_amount,
                max_per_address, max_supply, transfer_locked,
                mint_start, mint_end, base_uri, placeholder_uri, revealed,
                provenance_hash, fee_recipient,
            } => {
                execute_update_config(
                    deps, info, public_mint_enabled, mint_fee_denom, mint_fee_amount,
                    max_per_address, max_supply, transfer_locked,
                    mint_start, mint_end, base_uri, placeholder_uri, revealed,
                    provenance_hash, fee_recipient,
                )
            }

            ExecuteMsg::ProposeAdmin { new_admin } => execute_propose_admin(deps, info, new_admin),
            ExecuteMsg::AcceptAdmin {} => execute_accept_admin(deps, info),

            ExecuteMsg::Withdraw { to, denom, amount } => {
                execute_withdraw(deps, info, to, denom, amount)
            }

            ExecuteMsg::FixTokenUri { token_id } => execute_fix_token_uri(deps, env, info, token_id),
        };
    }

    // 当コントラクトの ExecuteMsg でなければ、cw721-base の Execute として処理
    // 転送ロックチェック（TransferNft/SendNft を拒否）
    let cw_msg: cw721_msg::ExecuteMsg<Metadata, cosmwasm_std::Empty> = from_json(&msg)?;
    if let cw721_msg::ExecuteMsg::TransferNft { .. }
        | cw721_msg::ExecuteMsg::SendNft { .. } = &cw_msg
    {
        let cfg = CONFIG.load(deps.storage)?;
        if cfg.transfer_locked {
            return Err(ContractError::TransferLocked);
        }
    }

    cw().execute(deps, env, info, cw_msg).map_err(ContractError::from)
}

// -------------------- public_mint --------------------
fn compose_token_uri(cfg: &Config, token_id: &str, provided: &str) -> String {
    if !cfg.revealed {
        if let Some(ph) = &cfg.placeholder_uri {
            return ph.clone();
        }
        return provided.to_string();
    }
    if let Some(base) = &cfg.base_uri {
        // base_uri + token_id
        let mut s = base.clone();
        if !s.ends_with('/') {
            s.push('/');
        }
        s.push_str(token_id);
        return s;
    }
    provided.to_string()
}

fn execute_public_mint(
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
    token_id: String,
    owner: String,
    token_uri: String,
    extension: Option<Metadata>,
) -> Result<Response, ContractError> {
    // --- 入力の軽微なバリデーション ---
    if token_id.trim().is_empty() {
        return Err(ContractError::Std(StdError::generic_err("empty token_id")));
    }
    if owner.trim().is_empty() {
        return Err(ContractError::Std(StdError::generic_err("empty owner")));
    }
    if token_uri.len() > 5_000 {
        return Err(ContractError::Std(StdError::generic_err("token_uri too long")));
    }

    let mut resp = Response::new().add_attribute("action", "public_mint");

    let cfg = CONFIG.load(deps.storage)?;
    if !cfg.public_mint_enabled {
        return Err(ContractError::PublicMintDisabled);
    }
    // 期間チェック
    check_time_window(&cfg, &env)?;

    // 手数料チェック & 転送メッセージ
    let fee_msgs = check_and_maybe_forward_fee(&cfg, &info)?;
    let fee_forwarded = if fee_msgs.is_empty() { "0" } else { "1" };

    // 供給上限
    let total = TOTAL_MINTED.load(deps.storage)?;
    if cfg.max_supply > 0 && total >= cfg.max_supply {
        return Err(ContractError::MaxSupplyReached);
    }

    // 1アドレス上限
    let owner_addr = deps.api.addr_validate(&owner)?;
    if cfg.max_per_address > 0 {
        let minted = MINTED_BY.may_load(deps.storage, &owner_addr)?.unwrap_or(0);
        if minted >= cfg.max_per_address {
            return Err(ContractError::PerAddressLimitReached);
        }
    }

    // 保存する token_uri を確定
    let final_uri = compose_token_uri(&cfg, &token_id, &token_uri);

    // cw721-base の Mint を sender=contract で実行
    let ext: Empty = extension.unwrap_or(Empty {});
    let mint_msg: cw721_msg::ExecuteMsg<Metadata, cosmwasm_std::Empty> = cw721_msg::ExecuteMsg::Mint {
        token_id: token_id.clone(),
        owner: owner.clone(),
        token_uri: Some(final_uri.clone()),
        extension: ext,
    };
    let fake_info = MessageInfo {
        sender: env.contract.address.clone(),
        funds: vec![], // cw721-base 側には資金を渡さない
    };
    cw().execute(deps.branch(), env.clone(), fake_info, mint_msg)
        .map_err(ContractError::from)?;

    // カウンタ更新
    TOTAL_MINTED.save(deps.storage, &(total + 1))?;
    if cfg.max_per_address > 0 {
        let prev = MINTED_BY.may_load(deps.storage, &owner_addr)?.unwrap_or(0);
        MINTED_BY.save(deps.storage, &owner_addr, &(prev + 1))?;
    }

    // レスポンス
    let phase = if cfg.revealed { "revealed" } else { "unrevealed" };
    Ok(Response::new()
        .add_messages(fee_msgs)
        .add_attribute("action", "public_mint")
        .add_attribute("phase", phase)
        .add_attribute("fee_forwarded", fee_forwarded)
        .add_attribute("token_id", token_id)
        .add_attribute("owner", owner)
        .add_attribute("token_uri", final_uri))
}

// -------------------- admin executes --------------------
#[allow(clippy::too_many_arguments)]
fn execute_update_config(
    deps: DepsMut,
    info: MessageInfo,
    public_mint_enabled: Option<bool>,
    mint_fee_denom: Option<String>,
    mint_fee_amount: Option<Uint128>,
    max_per_address: Option<u32>,
    max_supply: Option<u64>,
    transfer_locked: Option<bool>,
    mint_start: Option<u64>,
    mint_end: Option<u64>,
    base_uri: Option<String>,
    placeholder_uri: Option<String>,
    revealed: Option<bool>,
    provenance_hash: Option<String>,
    fee_recipient: Option<String>,
) -> Result<Response, ContractError> {
    CONFIG.update(deps.storage, |mut cfg| -> Result<_, ContractError> {
        ensure_admin(&cfg, &info.sender)?;

        if let Some(b) = public_mint_enabled { cfg.public_mint_enabled = b; }
        if let Some(d) = mint_fee_denom { cfg.mint_fee_denom = d; }
        if let Some(am) = mint_fee_amount { cfg.mint_fee_amount = am; }
        if let Some(mpa) = max_per_address { cfg.max_per_address = mpa; }
        if let Some(ms) = max_supply { cfg.max_supply = ms; }
        if let Some(tl) = transfer_locked { cfg.transfer_locked = tl; }

        if let Some(s) = mint_start { cfg.mint_start = s; }
        if let Some(e) = mint_end { cfg.mint_end = e; }

        if let Some(bu) = base_uri { cfg.base_uri = if bu.is_empty() { None } else { Some(bu) }; }
        if let Some(ph) = placeholder_uri { cfg.placeholder_uri = if ph.is_empty() { None } else { Some(ph) }; }
        if let Some(rv) = revealed { cfg.revealed = rv; }
        if let Some(pv) = provenance_hash { cfg.provenance_hash = if pv.is_empty() { None } else { Some(pv) }; }

        if let Some(fr) = fee_recipient {
            cfg.fee_recipient = if fr.is_empty() { None } else { Some(deps.api.addr_validate(&fr)?) };
        }

        Ok(cfg)
    })?;

    Ok(Response::new().add_attribute("action", "update_config"))
}

fn execute_propose_admin(
    deps: DepsMut,
    info: MessageInfo,
    new_admin: String,
) -> Result<Response, ContractError> {
    CONFIG.update(deps.storage, |mut cfg| -> Result<_, ContractError> {
        ensure_admin(&cfg, &info.sender)?;
        cfg.pending_admin = Some(deps.api.addr_validate(&new_admin)?);
        Ok(cfg)
    })?;
    Ok(Response::new().add_attribute("action", "propose_admin"))
}

fn execute_accept_admin(
    deps: DepsMut,
    info: MessageInfo,
) -> Result<Response, ContractError> {
    CONFIG.update(deps.storage, |mut cfg| -> Result<_, ContractError> {
        let Some(p) = &cfg.pending_admin else {
            return Err(ContractError::NoPendingAdmin);
        };
        if p != &info.sender {
            return Err(ContractError::Unauthorized);
        }
        cfg.admin = info.sender.clone();
        cfg.pending_admin = None;
        Ok(cfg)
    })?;
    Ok(Response::new().add_attribute("action", "accept_admin"))
}

fn execute_fix_token_uri(
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
    token_id: String,
) -> Result<Response, ContractError> {
    let cfg = CONFIG.load(deps.storage)?;
    ensure_admin(&cfg, &info.sender)?;

    if !cfg.revealed {
        return Err(ContractError::Std(StdError::generic_err("not revealed")));
    }
    let base = cfg.base_uri.clone().ok_or_else(|| StdError::generic_err("base_uri not set"))?;
    let mut new_uri = base;
    if !new_uri.ends_with('/') { new_uri.push('/'); }
    new_uri.push_str(&token_id);

    let msg: cw721_msg::ExecuteMsg<Metadata, cosmwasm_std::Empty> =
        cw721_msg::ExecuteMsg::UpdateTokenUri {
            token_id: token_id.clone(),
            token_uri: Some(new_uri.clone()),
        };

    let fake_info = MessageInfo { sender: env.contract.address.clone(), funds: vec![] };
    cw().execute(deps.branch(), env, fake_info, msg)
        .map_err(ContractError::from)?;

    Ok(Response::new()
        .add_attribute("action", "fix_token_uri")
        .add_attribute("token_id", token_id))
}

fn execute_withdraw(
    deps: DepsMut,
    info: MessageInfo,
    to: Option<String>,
    denom: String,
    amount: Option<Uint128>,
) -> Result<Response, ContractError> {
    let cfg = CONFIG.load(deps.storage)?;
    ensure_admin(&cfg, &info.sender)?;

    let to_addr = match to {
        Some(s) => deps.api.addr_validate(&s)?,
        None => cfg.fee_recipient.clone().ok_or_else(|| StdError::generic_err("fee_recipient not set and 'to' is empty"))?,
    };
    let amt = amount.unwrap_or_else(Uint128::zero);
    if amt.is_zero() {
        return Err(ContractError::Std(StdError::generic_err("amount must be > 0")));
    }

    let bank_msg = BankMsg::Send {
        to_address: to_addr.to_string(),
        amount: vec![coin(amt.u128(), denom)],
    };

    Ok(Response::new()
        .add_message(bank_msg)
        .add_attribute("action", "withdraw"))
}

// -------------------- query --------------------
#[entry_point]
pub fn query(deps: Deps, env: Env, msg: Binary) -> StdResult<Binary> {
    if let Ok(custom) = from_json::<CustomQueryMsg>(&msg) {
        return match custom {
            CustomQueryMsg::Config {} => {
                let cfg = CONFIG.load(deps.storage)?;
                to_json_binary(&ConfigResponse {
                    admin: cfg.admin.to_string(),
                    public_mint_enabled: cfg.public_mint_enabled,
                    mint_fee_denom: cfg.mint_fee_denom,
                    mint_fee_amount: cfg.mint_fee_amount,
                    max_per_address: cfg.max_per_address,
                    max_supply: cfg.max_supply,
                    transfer_locked: cfg.transfer_locked,

                    mint_start: cfg.mint_start,
                    mint_end: cfg.mint_end,
                    base_uri: cfg.base_uri.clone(),
                    placeholder_uri: cfg.placeholder_uri.clone(),
                    revealed: cfg.revealed,
                    provenance_hash: cfg.provenance_hash.clone(),
                    fee_recipient: cfg.fee_recipient.as_ref().map(|a| a.to_string()),
                    pending_admin: cfg.pending_admin.as_ref().map(|a| a.to_string()),
                })
            }
            CustomQueryMsg::MintPrice {} => {
                let cfg = CONFIG.load(deps.storage)?;
                to_json_binary(&MintPriceResponse {
                    denom: cfg.mint_fee_denom,
                    amount: cfg.mint_fee_amount,
                })
            }
            CustomQueryMsg::Supply {} => {
                let total = TOTAL_MINTED.load(deps.storage).unwrap_or(0);
                let cfg = CONFIG.load(deps.storage)?;
                to_json_binary(&SupplyResponse {
                    total_minted: total,
                    max_supply: cfg.max_supply,
                })
            }
        };
    }

    // だめなら cw721 標準クエリにフォールバック
    let cw_msg: cw721_msg::QueryMsg<Metadata> = from_json(&msg)?;
    cw().query(deps, env, cw_msg)
}

// -------------------- reply --------------------
#[entry_point]
pub fn reply(_deps: DepsMut, _env: Env, _reply: Reply) -> StdResult<Response> {
    Ok(Response::default())
}
