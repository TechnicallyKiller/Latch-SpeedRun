// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

/// @title IERC3009 — Transfer With Authorization (EIP-3009)
/// @notice Subset of the EIP-3009 interface as implemented by Circle's FiatTokenV2 (USDC).
///         Latch uses `receiveWithAuthorization` for funding: it is front-running-safe because
///         the token enforces `to == msg.sender`, so only the intended recipient (the LatchJob
///         escrow) can redeem the buyer's signed authorization.
/// @dev USDC's EIP-712 domain is name="USD Coin", version="2". Nonces are arbitrary 32-byte
///      values (not sequential), which lets Latch bind an authorization to a specific jobId.
interface IERC3009 {
    /// @notice Execute a transfer with a signed authorization where `to` must equal the caller.
    /// @param from Payer address (authorizer).
    /// @param to Payee address; the token requires `to == msg.sender`.
    /// @param value Amount to transfer.
    /// @param validAfter Authorization is invalid before this timestamp.
    /// @param validBefore Authorization is invalid at/after this timestamp.
    /// @param nonce Unique 32-byte nonce, single-use per authorizer.
    /// @param v ECDSA signature component.
    /// @param r ECDSA signature component.
    /// @param s ECDSA signature component.
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    /// @notice Execute a transfer with a signed authorization (no caller binding).
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    /// @notice Returns the state of an authorization (true if used or cancelled).
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
}
