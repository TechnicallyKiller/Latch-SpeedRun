// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

import {LatchTestBase} from "./Base.t.sol";
import {LatchJob} from "../src/LatchJob.sol";

/// @notice Property/fuzz tests over amounts, fees, bonds, timing, and signatures.
contract LatchJobFuzzTest is LatchTestBase {
    // secp256k1 group order — valid private keys are in [1, N-1].
    uint256 internal constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    /// @dev Drive a job to UnderVerification with arbitrary economics and a chosen verdict.
    ///      Split into shallow sub-calls to keep each stack frame small.
    function _driveToUV(uint256 amount, uint256 bond, uint32 window, bool pass)
        internal
        returns (uint256 jobId, uint256 verdictTime)
    {
        usdc.mint(buyer, amount);
        usdc.mint(provider, bond);

        vm.prank(buyer);
        jobId = latch.createJob(
            provider, amount, bond, keccak256("p"), 0, uint64(block.timestamp + 1 days), window
        );
        _fundAmt(jobId, amount);
        _acceptAmt(jobId, bond);

        vm.prank(provider);
        latch.submitDeliverable(jobId, keccak256("d"));

        _postVerdictAmt(jobId, pass);
        verdictTime = block.timestamp;
    }

    function _fundAmt(uint256 jobId, uint256 amount) internal {
        (uint8 v, bytes32 r, bytes32 s) =
            _signReceive(buyerPk, buyer, amount, 0, block.timestamp + 1 hours, latch.escrowNonce(jobId));
        latch.fundJob(jobId, 0, block.timestamp + 1 hours, v, r, s);
    }

    function _acceptAmt(uint256 jobId, uint256 bond) internal {
        (uint8 v, bytes32 r, bytes32 s) =
            _signReceive(providerPk, provider, bond, 0, block.timestamp + 1 hours, latch.bondNonce(jobId));
        vm.prank(provider);
        latch.acceptJob(jobId, 0, block.timestamp + 1 hours, v, r, s);
    }

    function _postVerdictAmt(uint256 jobId, bool pass) internal {
        uint256 deadline = block.timestamp + 1 hours;
        uint256 score = pass ? 100 : 0;
        bytes memory sig = _signVerdict(verifierPk, jobId, pass, score, keccak256("r"), "ipfs://e", deadline);
        latch.submitVerdict(jobId, pass, score, keccak256("r"), "ipfs://e", deadline, _one(sig));
    }

    /// @dev PASS settlement: provider gets amount-fee+bond, feeRecipient gets fee, nothing leaks.
    function testFuzz_pass_accounting(uint256 amount, uint256 bond, uint16 feeBps) public {
        amount = bound(amount, 1, 1e15);
        bond = bound(bond, 0, 1e15);
        feeBps = uint16(bound(feeBps, 0, latch.MAX_FEE_BPS()));

        vm.prank(owner);
        latch.setProtocolFee(feeBps);

        (uint256 jobId,) = _driveToUV(amount, bond, CHALLENGE_WINDOW, true);
        vm.warp(block.timestamp + CHALLENGE_WINDOW);
        latch.finalize(jobId);

        uint256 fee = (amount * feeBps) / 10_000;
        assertEq(latch.withdrawable(provider), amount - fee + bond, "provider proceeds");
        assertEq(latch.withdrawable(feeRecipient), fee, "fee");
        assertLe(fee, amount, "fee never exceeds amount"); // rounding-down property
        assertEq(latch.totalEscrowed(), 0);
        assertEq(latch.totalBondsLocked(), 0);
        _assertSolvent();
    }

    /// @dev FAIL settlement: buyer refunded amount + slashed provider bond; no fee charged.
    function testFuzz_fail_accounting(uint256 amount, uint256 bond) public {
        amount = bound(amount, 1, 1e15);
        bond = bound(bond, 0, 1e15);

        (uint256 jobId,) = _driveToUV(amount, bond, CHALLENGE_WINDOW, false);
        vm.warp(block.timestamp + CHALLENGE_WINDOW);
        latch.finalize(jobId);

        assertEq(latch.withdrawable(buyer), amount + bond, "buyer refund + slashed bond");
        assertEq(latch.withdrawable(provider), 0);
        assertEq(latch.withdrawable(feeRecipient), 0, "no fee on refund");
        assertEq(latch.totalEscrowed(), 0);
        assertEq(latch.totalBondsLocked(), 0);
        _assertSolvent();
    }

    /// @dev finalize succeeds iff the full challenge window has elapsed.
    function testFuzz_finalizeTiming(uint32 window, uint256 warpBy) public {
        window = uint32(bound(window, latch.MIN_CHALLENGE_WINDOW(), latch.MAX_CHALLENGE_WINDOW()));
        warpBy = bound(warpBy, 0, uint256(window) * 2 + 5);

        (uint256 jobId, uint256 verdictTime) = _driveToUV(AMOUNT, PROVIDER_BOND, window, true);
        vm.warp(verdictTime + warpBy);

        if (warpBy < window) {
            vm.expectRevert(LatchJob.ChallengeWindowOpen.selector);
            latch.finalize(jobId);
        } else {
            latch.finalize(jobId);
            assertEq(uint8(latch.getJob(jobId).state), uint8(LatchJob.State.Released));
            _assertSolvent();
        }
    }

    /// @dev Only an active (staked) verifier's signature can advance a job; any other key reverts.
    function testFuzz_onlyActiveVerifierSigAdvances(uint256 badPk) public {
        badPk = bound(badPk, 1, SECP256K1_N - 1);
        vm.assume(vm.addr(badPk) != verifier);

        uint256 jobId = _createJob();
        _fund(jobId);
        _accept(jobId);
        _submit(jobId);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signVerdict(badPk, jobId, true, 100, keccak256("r"), "ipfs://e", deadline);
        vm.expectRevert(LatchJob.InvalidVerifierSignature.selector);
        latch.submitVerdict(jobId, true, 100, keccak256("r"), "ipfs://e", deadline, _one(sig));
    }

    /// @dev A funding authorization is bound to its jobId: a signature for one job cannot fund another.
    function testFuzz_fundingNonceIsJobBound(uint256 amount) public {
        amount = bound(amount, 1, 1e15);
        usdc.mint(buyer, amount * 2);

        vm.startPrank(buyer);
        uint256 jobA = latch.createJob(provider, amount, 0, keccak256("a"), 0, uint64(block.timestamp + 1 days), CHALLENGE_WINDOW);
        uint256 jobB = latch.createJob(provider, amount, 0, keccak256("b"), 0, uint64(block.timestamp + 1 days), CHALLENGE_WINDOW);
        vm.stopPrank();

        // sign a funding authorization for jobA's nonce...
        bytes32 nonceA = latch.escrowNonce(jobA);
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(buyerPk, buyer, amount, 0, block.timestamp + 1 hours, nonceA);

        // ...and try to use it to fund jobB: the contract recomputes jobB's nonce -> signature mismatch.
        vm.expectRevert(); // MockUSDC.AuthInvalidSignature
        latch.fundJob(jobB, 0, block.timestamp + 1 hours, v, r, s);

        // the same authorization funds jobA correctly.
        latch.fundJob(jobA, 0, block.timestamp + 1 hours, v, r, s);
        assertEq(uint8(latch.getJob(jobA).state), uint8(LatchJob.State.Funded));
    }
}
