use cosmwasm_schema::cw_serde;
use cosmwasm_std::Addr;
use cw_storage_plus::{Item, Map};

pub const NEXT_ID: Item<u64> = Item::new("next_id");
pub const ADMIN: Item<Addr> = Item::new("admin");
pub const VERIFIERS: Map<&Addr, bool> = Map::new("verifiers");

#[cw_serde]
pub struct StoredRecord {
    pub id: u64,
    pub sender: Addr,

    // 主要インデックス項目
    pub observed_at: u64,
    pub species: Option<String>,
    pub geohash_prefix: String,

    // CID（必須）
    pub cid: String,

    // 元の任意JSON
    pub payload: serde_json::Value,

    // 監査情報
    pub block_time: u64,
    pub block_height: u64,

    // 管理用
    pub hidden: bool,
    pub hidden_reason: Option<String>,

    pub annotations: Vec<Annotation>,
    pub verifications: Vec<VerificationEntry>,
}

#[cw_serde]
pub struct Annotation {
    pub at: u64,
    pub by: Addr,
    pub note: Option<String>,
    pub photo_cid: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[cw_serde]
pub struct VerificationEntry {
    pub at: u64,
    pub verifier: Addr,
    pub taxon_id: String,
    pub confidence: u8,
}

pub const RECORDS: Map<u64, StoredRecord> = Map::new("records");

// セカンダリ・インデックス
pub const BY_TIME: Map<(u64, u64), ()> = Map::new("idx_time");       // (observed_at, id)
pub const BY_SPECIES: Map<(String, u64), ()> = Map::new("idx_species"); // (species_norm, id)
pub const BY_GEOHASH: Map<(String, u64), ()> = Map::new("idx_geohash"); // (geohash_prefix, id)

pub fn normalize_species(s: &str) -> String {
    s.trim().to_ascii_lowercase()
}
