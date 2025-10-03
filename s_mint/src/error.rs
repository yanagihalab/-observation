use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("Unauthorized")]
    Unauthorized,

    #[error("Public mint is disabled")]
    PublicMintDisabled,

    #[error("Mint is not open now")]
    MintNotOpen,

    #[error("Insufficient mint fee")]
    InsufficientMintFee,

    #[error("Per-address mint limit reached")]
    PerAddressLimitReached,

    #[error("Max supply reached")]
    MaxSupplyReached,

    #[error("Transfers are locked")]
    TransferLocked,

    #[error("No pending admin")]
    NoPendingAdmin,

    // 追加（fix_token_uri で使うと便利）
    #[error("Not revealed")]
    NotRevealed,

    #[error("Base URI is not set")]
    BaseUriNotSet,
}

impl From<cw721_base::ContractError> for ContractError {
    fn from(err: cw721_base::ContractError) -> Self {
        ContractError::Std(StdError::generic_err(err.to_string()))
    }
}
