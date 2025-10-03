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
