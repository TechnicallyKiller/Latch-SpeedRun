// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

/// @title ERC-8004 registry interfaces (subset used by Latch)
/// @notice Identity + Reputation are deployed canonically on Avalanche; Validation has no
///         canonical deployment yet, so Latch deploys the reference implementation itself.
///         These minimal interfaces are the integration seam; the actual registry wiring lands
///         in the agent/finalize path (build-order step 5). Signatures are intentionally narrow
///         and may be widened once pinned against the deployed ABIs.

/// @notice Reputation registry — feedback written after settlement.
interface IReputationRegistry {
    /// @param agentId ERC-8004 identity id of the rated agent (the provider).
    /// @param score Feedback score.
    /// @param reasonHash ERC-8183-style reason hash linking to off-chain evidence.
    function giveFeedback(uint256 agentId, uint8 score, bytes32 reasonHash) external;
}

/// @notice Validation registry — independent validator records (Latch writes its verdict here).
interface IValidationRegistry {
    /// @param agentId ERC-8004 identity id of the validated agent (the provider).
    /// @param pass Whether the deliverable passed verification.
    /// @param reasonHash Hash committing to the verdict's public evidence.
    function recordValidation(uint256 agentId, bool pass, bytes32 reasonHash) external;
}
