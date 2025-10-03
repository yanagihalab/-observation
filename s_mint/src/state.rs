use cosmwasm_schema::cw_serde;
use cosmwasm_std::{Addr, Uint128};
use cw_storage_plus::{Item, Map};

#[cw_serde]
pub struct Config {
    pub admin: Addr,
    pub public_mint_enabled: bool,

    // fee（空/0なら無料）
    pub mint_fee_denom: String,
    pub mint_fee_amount: Uint128,

    // 上限
    pub max_per_address: u32,
    pub max_supply: u64,

    // 転送ロック
    pub transfer_locked: bool,

    // 期間（0=無制限）
    pub mint_start: u64,
    pub mint_end: u64,

    // Reveal/Provenance
    pub base_uri: Option<String>,
    pub placeholder_uri: Option<String>,
    pub revealed: bool,
    pub provenance_hash: Option<String>,

    // 受取先
    pub fee_recipient: Option<Addr>,

    // 2段階Admin移譲
    pub pending_admin: Option<Addr>,
}

pub const CONFIG: Item<Config> = Item::new("config");

// 総ミント数
pub const TOTAL_MINTED: Item<u64> = Item::new("total_minted");

// アドレスごとのミント数
pub const MINTED_BY: Map<&Addr, u32> = Map::new("minted_by");
