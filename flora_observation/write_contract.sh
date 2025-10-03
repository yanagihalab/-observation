#!/usr/bin/env bash
set -euo pipefail

# ===== Cargo.toml を上書き（CosmWasm 1.5 系 & cw721-base 0.18.0 対応）=====
cat > Cargo.toml <<'TOML'
[package]
name = "participation-certificate-nft"
version = "0.1.0"
edition = "2021"
resolver = "2"
license = "Apache-2.0"

[lib]
crate-type = ["cdylib", "rlib"]

[features]
# 追加 feature が必要ならここに記載

[dependencies]
cosmwasm-schema  = "1.5"
cosmwasm-std     = "1.5"
# ← ここが肝: Item/Map は cw_storage_plus から
cw-storage-plus  = "1.2"
schemars         = "0.8"
serde            = { version = "1.0", features = ["derive"] }
thiserror        = "1.0"

cw2              = "1.1.2"
cw721            = "0.18.0"
cw721-base       = { version = "0.18.0", features = ["library"] }

[dev-dependencies]
cosmwasm-schema = "1.5"
TOML

mkdir -p src

# ===== src/error.rs =====
cat > src/error.rs <<'RS'
use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("Std error: {0}")]
    Std(#[from] StdError),

    #[error("cw721 error: {0}")]
    Cw721(#[from] cw721_base::ContractError),

    #[error("Max supply reached")]
    MaxSupplyReached,

    #[error("Already minted one per address")]
    AlreadyMinted,
}
RS

# ===== src/state.rs（cw_storage_plus を使用）=====
cat > src/state.rs <<'RS'
use cosmwasm_schema::cw_serde;
use cosmwasm_std::Addr;
use cw_storage_plus::{Item, Map};

#[cw_serde]
pub struct Config {
    pub admin: Addr,
    pub next_token_id: u64,
    pub max_supply: Option<u64>,
}

pub const CONFIG: Item<Config> = Item::new("config");
pub const MINTED: Item<u64> = Item::new("minted");
pub const MINTED_BY: Map<&Addr, bool> = Map::new("minted_by");
RS

# ===== src/msg.rs（ExecuteMsg のジェネリクスを <Empty, Empty> に）=====
cat > src/msg.rs <<'RS'
use cosmwasm_schema::cw_serde;
use cosmwasm_std::Empty;

// Query は cw721-base の QueryMsg をそのまま採用（ジェネリク1つ）
pub type QueryMsg = cw721_base::msg::QueryMsg<Empty>;

#[cw_serde]
pub struct InstantiateMsg {
    pub name: String,
    pub symbol: String,
    /// 最大供給量（省略時は無制限）
    pub max_supply: Option<u64>,
}

#[cw_serde]
pub enum ExecuteMsg {
    /// フリーミント
    PublicMint {},
    /// 標準 CW721 実行の委譲（TransferNft / SendNft / Burn / Approve ...）
    Cw721(cw721_base::msg::ExecuteMsg<Empty, Empty>),
}
RS

# ===== src/lib.rs（Cw721Contract::default() 使用、Mint は構造体バリアント、to_json_binary へ）=====
cat > src/lib.rs <<'RS'
#![allow(unused_imports)]

use cosmwasm_std::{
    entry_point, to_json_binary, Addr, Binary, Deps, DepsMut, Empty, Env, MessageInfo, Response,
    StdResult, WasmMsg,
};
use cw2::set_contract_version;
use cw721_base::{msg as cw721_msg, Cw721Contract};

use crate::error::ContractError;
use crate::msg::{ExecuteMsg, InstantiateMsg, QueryMsg};
use crate::state::{Config, CONFIG, MINTED, MINTED_BY};

pub mod error;
pub mod msg;
pub mod state;

// ------------------------------
// 定数: バージョン, 直書きURI
// ------------------------------
const CONTRACT_NAME: &str = "cw721-free-mint";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// ★ 固定1個のメタデータ URI（指定どおり）
const FIXED_URI: &str =
    "https://ipfs.yamada.jo.sus.ac.jp/ipfs/QmTGDRGPFtX5QZhiwk2gUBzs9CaBmrFEMEuKn29G7saBfx";

/// ★ BASE_URI は連番 JSON 用だが、今回は固定 JSON を使うため未使用
const BASE_URI: &str = "";               // 未使用（連番運用に切り替える場合のみ設定）
const USE_NUMBERED_JSON: bool = false;   // ← 固定 JSON を使う

// ------------------------------
// Instantiate
// ------------------------------
#[entry_point]
pub fn instantiate(
    mut deps: DepsMut,  // ← ここを mut に修正
    env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;

    // cw721-base をこのコントラクト自身を minter にして初期化
    let cw721_init = cw721_msg::InstantiateMsg {
        name: msg.name.clone(),
        symbol: msg.symbol.clone(),
        minter: env.contract.address.to_string(), // ← 自分自身をミンターに
    };

    // ★ Cw721Contract は default() でOK（'static ライフタイム）
    let cw721 = Cw721Contract::<Empty, Empty, Empty, Empty>::default();
    cw721.instantiate(deps.branch(), env.clone(), info.clone(), cw721_init)?;

    let cfg = Config {
        admin: info.sender.clone(),
        next_token_id: 1,
        max_supply: msg.max_supply,
    };
    CONFIG.save(deps.storage, &cfg)?;
    MINTED.save(deps.storage, &0u64)?;

    Ok(Response::new()
        .add_attribute("action", "instantiate")
        .add_attribute("name", msg.name)
        .add_attribute("symbol", msg.symbol))
}

// ------------------------------
// Execute
// ------------------------------
#[entry_point]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::PublicMint {} => exec_public_mint(deps, env, info),
        ExecuteMsg::Cw721(inner) => {
            // 標準 CW721 実行をそのまま委譲
            let cw721 = Cw721Contract::<Empty, Empty, Empty, Empty>::default();
            cw721.execute(deps, env, info, inner).map_err(ContractError::from)
        }
    }
}

fn exec_public_mint(deps: DepsMut, env: Env, info: MessageInfo) -> Result<Response, ContractError> {
    let mut cfg = CONFIG.load(deps.storage)?;

    // 1アドレス1枚: 既にミント済みなら拒否
    if MINTED_BY.may_load(deps.storage, &info.sender)?.unwrap_or(false) {
        return Err(ContractError::AlreadyMinted);
    }

    // 最大供給量チェック
    if let Some(max) = cfg.max_supply {
        let minted = MINTED.load(deps.storage)?;
        if minted >= max {
            return Err(ContractError::MaxSupplyReached);
        }
    }

    // token_id を確定 & 次のIDへ
    let token_id = cfg.next_token_id;
    cfg.next_token_id = cfg.next_token_id.checked_add(1).unwrap();
    CONFIG.save(deps.storage, &cfg)?;

    // 直書きURIの生成（今回は固定）
    let token_uri = if USE_NUMBERED_JSON {
        Some(format!("{}{}.json", BASE_URI, token_id))
    } else {
        Some(FIXED_URI.to_string())
    };

    // cw721-base の Mint（minter は本コントラクト自身）
    // ※ ExecuteMsg は 2 ジェネリクス（T, E）
    let mint_msg: cw721_msg::ExecuteMsg<Empty, Empty> = cw721_msg::ExecuteMsg::Mint {
        token_id: token_id.to_string(),
        owner: info.sender.to_string(),
        token_uri,
        extension: Empty {},
    };

    let sub = WasmMsg::Execute {
        contract_addr: env.contract.address.to_string(),
        msg: to_json_binary(&mint_msg)?,
        funds: vec![],
    };

    // ミントカウンタ更新 & フラグ
    let minted_now = MINTED.load(deps.storage)?.saturating_add(1);
    MINTED.save(deps.storage, &minted_now)?;
    MINTED_BY.save(deps.storage, &info.sender, &true)?;

    Ok(Response::new()
        .add_message(sub)
        .add_attribute("action", "public_mint")
        .add_attribute("to", info.sender)
        .add_attribute("token_id", token_id.to_string()))
}

// ------------------------------
// Query: cw721-base に委譲
// ------------------------------
#[entry_point]
pub fn query(deps: Deps, env: Env, msg: QueryMsg) -> StdResult<Binary> {
    let cw721 = Cw721Contract::<Empty, Empty, Empty, Empty>::default();
    cw721.query(deps, env, msg)
}
RS

echo "✅ Fixed sources written: Cargo.toml + src/{lib.rs,msg.rs,error.rs,state.rs}"
