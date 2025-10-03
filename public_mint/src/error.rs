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
