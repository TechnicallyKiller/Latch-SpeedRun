// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

import {Test, console2} from "forge-std/Test.sol";
import {LatchJob} from "../src/LatchJob.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// @notice Emits a golden EIP-712 verdict digest for a fixed (chainId, contract, inputs) tuple.
///         The Rust verifier asserts byte-for-byte equality against these values, proving the
///         off-chain signer and the on-chain `verdictDigest` agree on the typed-data encoding.
contract VerdictDigestTest is Test {
    // Fixed verdict inputs shared with the Rust golden test.
    uint256 constant JOB_ID = 1;
    bool constant PASS = true;
    uint256 constant SCORE = 95;
    bytes32 constant REASON = bytes32(uint256(0xABCDEF));
    string constant EVIDENCE_URI = "cas://abc";
    uint256 constant DEADLINE = 1_000_000;

    function test_emit_golden_digest() public {
        vm.chainId(31337); // pin so the domain separator is deterministic across machines

        MockUSDC usdc = new MockUSDC();
        LatchJob latch = new LatchJob(
            usdc,
            address(0x1111),
            address(0x2222),
            address(0x3333),
            100,
            50e6,
            1 days
        );

        bytes32 digest = latch.verdictDigest(JOB_ID, PASS, SCORE, REASON, EVIDENCE_URI, DEADLINE);

        console2.log("GOLDEN_CHAINID:", block.chainid);
        console2.log("GOLDEN_LATCH:", address(latch));
        console2.log("GOLDEN_REASON:");
        console2.logBytes32(REASON);
        console2.log("GOLDEN_DIGEST:");
        console2.logBytes32(digest);
    }
}
