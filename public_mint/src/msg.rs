use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::{Uint128, Empty};

// 拡張メタデータなし（= Empty）
pub type Metadata = Empty;

#[cw_serde]
pub struct InstantiateMsg {
    pub name: String,
    pub symbol: String,

    // 既存
    pub admin: Option<String>,
    pub public_mint_enabled: Option<bool>,
    pub mint_fee_denom: Option<String>,
    pub mint_fee_amount: Option<Uint128>,
    pub max_per_address: Option<u32>,
    pub max_supply: Option<u64>,
    pub transfer_locked: Option<bool>,

    // 追加
    pub mint_start: Option<u64>,
    pub mint_end: Option<u64>,
    pub base_uri: Option<String>,
    pub placeholder_uri: Option<String>,
    pub revealed: Option<bool>,
    pub provenance_hash: Option<String>,
    pub fee_recipient: Option<String>,
}

#[cw_serde]
pub enum ExecuteMsg {
    // 公開ミント（/ mint）: フロント既存と互換
    PublicMint {
        token_id: String,
        owner: String,
        token_uri: String,          // 非公開中は無視して placeholder を採用
        extension: Option<Metadata> // 未使用
    },
    Mint {
        token_id: String,
        owner: String,
        token_uri: String,
        extension: Option<Metadata>
    },

    // 設定の更新（任意の項目のみ）
    UpdateConfig {
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
    },

    // 2段階Admin移譲
    ProposeAdmin { new_admin: String },
    AcceptAdmin {},

    // 手数料引き出し（to未指定なら fee_recipient）
    Withdraw {
        to: Option<String>,
        denom: String,
        amount: Option<Uint128>, // None/0 は禁止（簡易）
    },

    // Reveal後に既発行トークンのURIを base_uri+token_id に更新
    FixTokenUri { token_id: String },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum CustomQueryMsg {
    #[returns(ConfigResponse)]
    Config {},

    #[returns(MintPriceResponse)]
    MintPrice {},

    #[returns(SupplyResponse)]
    Supply {},
}

#[cw_serde]
pub struct ConfigResponse {
    pub admin: String,
    pub public_mint_enabled: bool,
    pub mint_fee_denom: String,
    pub mint_fee_amount: Uint128,
    pub max_per_address: u32,
    pub max_supply: u64,
    pub transfer_locked: bool,

    pub mint_start: u64,
    pub mint_end: u64,
    pub base_uri: Option<String>,
    pub placeholder_uri: Option<String>,
    pub revealed: bool,
    pub provenance_hash: Option<String>,
    pub fee_recipient: Option<String>,
    pub pending_admin: Option<String>,
}

#[cw_serde]
pub struct MintPriceResponse {
    pub denom: String,
    pub amount: Uint128,
}

#[cw_serde]
pub struct SupplyResponse {
    pub total_minted: u64,
    pub max_supply: u64,
}
