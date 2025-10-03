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
