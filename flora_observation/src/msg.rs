use cosmwasm_schema::{cw_serde, QueryResponses};

#[cw_serde]
pub struct InstantiateMsg {
    pub start_id: Option<u64>,
    pub admin: Option<String>,
    pub verifiers: Option<Vec<String>>,
}

#[cw_serde]
pub enum ExecuteMsg {
    /// CID は必須（"bafy..." または "ipfs://bafy..."）
    Store { payload: serde_json::Value, cid: String },

    AppendAnnotation {
        id: u64,
        note: Option<String>,
        photo_cid: Option<String>,
        tags: Option<Vec<String>>,
    },

    Verify {
        id: u64,
        taxon_id: String,
        confidence: u8,
    },

    Hide { id: u64, reason: Option<String> },

    SetVerifier { addr: String, enabled: bool },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    #[returns(GetResp)]
    Get { id: u64 },

    #[returns(ListResp)]
    List {
        species: Option<String>,
        geohash_prefix: Option<String>,
        start: Option<u64>,
        end: Option<u64>,
        limit: Option<u32>,
        start_after: Option<u64>,
    },

    #[returns(CountResp)]
    Count {
        species: Option<String>,
        geohash_prefix: Option<String>,
        start: Option<u64>,
        end: Option<u64>,
    },

    #[returns(StatsMonthlyResp)]
    StatsMonthly {
        species: Option<String>,
        geohash_prefix: Option<String>,
        year: u32,
    },
}

#[cw_serde]
pub struct GetResp {
    pub record: Option<super::state::StoredRecord>,
}

#[cw_serde]
pub struct ListResp {
    pub records: Vec<super::state::StoredRecord>,
    pub next_start_after: Option<u64>,
}

#[cw_serde]
pub struct CountResp {
    pub count: u64,
}

#[cw_serde]
pub struct StatsMonthlyResp {
    /// index 0..11 が Jan..Dec
    pub months: [u64; 12],
}
