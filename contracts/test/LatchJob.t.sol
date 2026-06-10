// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

import {LatchTestBase} from "./Base.t.sol";
import {LatchJob} from "../src/LatchJob.sol";
import {BondModule} from "../src/BondModule.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract LatchJobTest is LatchTestBase {
    // ---------------------------------------------------------------------
    // Creation
    // ---------------------------------------------------------------------

    function test_createJob_setsTermsAndState() public {
        uint256 jobId = _createJob();
        LatchJob.Job memory j = latch.getJob(jobId);
        assertEq(j.buyer, buyer);
        assertEq(j.provider, provider);
        assertEq(j.amount, AMOUNT);
        assertEq(j.providerBond, PROVIDER_BOND);
        assertEq(j.protocolFeeBps, FEE_BPS);
        assertEq(uint8(j.state), uint8(LatchJob.State.Created));
        assertEq(latch.jobCount(), 1);
    }

    function test_createJob_revertsProviderIsBuyer() public {
        vm.prank(buyer);
        vm.expectRevert(LatchJob.NotJobParty.selector);
        latch.createJob(buyer, AMOUNT, PROVIDER_BOND, bytes32(0), 0, uint64(block.timestamp + 1 days), CHALLENGE_WINDOW);
    }

    function test_createJob_revertsZeroAmount() public {
        vm.prank(buyer);
        vm.expectRevert(LatchJob.InvalidAmount.selector);
        latch.createJob(provider, 0, PROVIDER_BOND, bytes32(0), 0, uint64(block.timestamp + 1 days), CHALLENGE_WINDOW);
    }

    function test_createJob_revertsBadWindow() public {
        vm.prank(buyer);
        vm.expectRevert(LatchJob.InvalidChallengeWindow.selector);
        latch.createJob(provider, AMOUNT, PROVIDER_BOND, bytes32(0), 0, uint64(block.timestamp + 1 days), 1);
    }

    function test_createJob_revertsPastDeadline() public {
        vm.prank(buyer);
        vm.expectRevert(LatchJob.DeadlinePassed.selector);
        latch.createJob(provider, AMOUNT, PROVIDER_BOND, bytes32(0), 0, uint64(block.timestamp), CHALLENGE_WINDOW);
    }

    // ---------------------------------------------------------------------
    // Funding
    // ---------------------------------------------------------------------

    function test_fundJob_pullsExactAmount() public {
        uint256 jobId = _createJob();
        uint256 buyerBefore = usdc.balanceOf(buyer);
        uint256 latchBefore = usdc.balanceOf(address(latch)); // already holds the verifier stake
        _fund(jobId);

        assertEq(usdc.balanceOf(address(latch)) - latchBefore, AMOUNT);
        assertEq(usdc.balanceOf(buyer), buyerBefore - AMOUNT);
        assertEq(latch.totalEscrowed(), AMOUNT);
        assertEq(uint8(latch.getJob(jobId).state), uint8(LatchJob.State.Funded));
        _assertSolvent();
    }

    function test_fundJob_revertsWrongState() public {
        uint256 jobId = _createJob();
        _fund(jobId);
        // funding again should revert (state is now Funded)
        bytes32 nonce = latch.escrowNonce(jobId);
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(buyerPk, buyer, AMOUNT, 0, block.timestamp + 1 hours, nonce);
        vm.expectRevert(abi.encodeWithSelector(LatchJob.InvalidState.selector, LatchJob.State.Created, LatchJob.State.Funded));
        latch.fundJob(jobId, 0, block.timestamp + 1 hours, v, r, s);
    }

    function test_fundJob_revertsWrongNonce() public {
        uint256 jobId = _createJob();
        // sign with an arbitrary (wrong) nonce; contract recomputes the bound nonce -> sig mismatch
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(buyerPk, buyer, AMOUNT, 0, block.timestamp + 1 hours, keccak256("wrong"));
        vm.expectRevert(); // MockUSDC.AuthInvalidSignature
        latch.fundJob(jobId, 0, block.timestamp + 1 hours, v, r, s);
    }

    // ---------------------------------------------------------------------
    // Accept / submit
    // ---------------------------------------------------------------------

    function test_accept_locksBond() public {
        uint256 jobId = _createJob();
        _fund(jobId);
        _accept(jobId);
        assertEq(latch.totalBondsLocked(), PROVIDER_BOND);
        assertEq(uint8(latch.getJob(jobId).state), uint8(LatchJob.State.InProgress));
        _assertSolvent();
    }

    function test_accept_revertsNotProvider() public {
        uint256 jobId = _createJob();
        _fund(jobId);
        bytes32 nonce = latch.bondNonce(jobId);
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(providerPk, provider, PROVIDER_BOND, 0, block.timestamp + 1 hours, nonce);
        vm.prank(buyer);
        vm.expectRevert(LatchJob.NotProvider.selector);
        latch.acceptJob(jobId, 0, block.timestamp + 1 hours, v, r, s);
    }

    function test_submit_revertsAfterDeadline() public {
        uint256 jobId = _createJob();
        _fund(jobId);
        _accept(jobId);
        vm.warp(block.timestamp + 2 days);
        vm.prank(provider);
        vm.expectRevert(LatchJob.DeadlinePassed.selector);
        latch.submitDeliverable(jobId, keccak256("x"));
    }

    // ---------------------------------------------------------------------
    // Verdict
    // ---------------------------------------------------------------------

    function test_submitVerdict_recordsAndOpensWindow() public {
        uint256 jobId = _toUnderVerification(true);
        LatchJob.Job memory j = latch.getJob(jobId);
        assertEq(uint8(j.state), uint8(LatchJob.State.UnderVerification));
        assertTrue(j.verdictPass);
        assertEq(j.verdictScore, 95);
        assertEq(j.verdictTime, uint64(block.timestamp));
    }

    function test_submitVerdict_revertsBadSigner() public {
        uint256 jobId = _createJob();
        _fund(jobId);
        _accept(jobId);
        _submit(jobId);
        uint256 deadline = block.timestamp + 1 hours;
        // signed by buyer, not the registered verifier
        bytes memory sig = _signVerdict(buyerPk, jobId, true, 95, keccak256("r"), "ipfs://e", deadline);
        vm.expectRevert(LatchJob.InvalidVerifierSignature.selector);
        latch.submitVerdict(jobId, true, 95, keccak256("r"), "ipfs://e", deadline, _one(sig));
    }

    function test_submitVerdict_revertsExpired() public {
        uint256 jobId = _createJob();
        _fund(jobId);
        _accept(jobId);
        _submit(jobId);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signVerdict(verifierPk, jobId, true, 95, keccak256("r"), "ipfs://e", deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(LatchJob.VerdictExpired.selector);
        latch.submitVerdict(jobId, true, 95, keccak256("r"), "ipfs://e", deadline, _one(sig));
    }

    function test_submitVerdict_revertsAfterVerifierUnstaked() public {
        uint256 jobId = _createJob();
        _fund(jobId);
        _accept(jobId);
        _submit(jobId);
        // verifier exits the set by unstaking below the minimum -> no longer active
        vm.prank(verifier);
        latch.unstakeVerifier(MIN_VERIFIER_STAKE);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signVerdict(verifierPk, jobId, true, 95, keccak256("r"), "ipfs://e", deadline);
        vm.expectRevert(LatchJob.InvalidVerifierSignature.selector);
        latch.submitVerdict(jobId, true, 95, keccak256("r"), "ipfs://e", deadline, _one(sig));
    }

    // ---------------------------------------------------------------------
    // Optimistic finalize
    // ---------------------------------------------------------------------

    function test_finalize_pass_releasesToProvider() public {
        uint256 jobId = _toUnderVerification(true);
        vm.warp(block.timestamp + CHALLENGE_WINDOW);
        latch.finalize(jobId);

        uint256 fee = (AMOUNT * FEE_BPS) / 10_000;
        assertEq(latch.withdrawable(provider), AMOUNT - fee + PROVIDER_BOND);
        assertEq(latch.withdrawable(feeRecipient), fee);
        assertEq(uint8(latch.getJob(jobId).state), uint8(LatchJob.State.Released));
        assertEq(latch.totalEscrowed(), 0);
        assertEq(latch.totalBondsLocked(), 0);
        _assertSolvent();
    }

    function test_finalize_fail_refundsBuyerAndSlashesBond() public {
        uint256 jobId = _toUnderVerification(false);
        vm.warp(block.timestamp + CHALLENGE_WINDOW);
        latch.finalize(jobId);

        // buyer refunded full amount + slashed provider bond; zero fee on refund
        assertEq(latch.withdrawable(buyer), AMOUNT + PROVIDER_BOND);
        assertEq(latch.withdrawable(feeRecipient), 0);
        assertEq(latch.withdrawable(provider), 0);
        assertEq(uint8(latch.getJob(jobId).state), uint8(LatchJob.State.Refunded));
        _assertSolvent();
    }

    function test_finalize_revertsBeforeWindow() public {
        uint256 jobId = _toUnderVerification(true);
        vm.expectRevert(LatchJob.ChallengeWindowOpen.selector);
        latch.finalize(jobId);
    }

    function test_finalize_revertsDoubleFinalize() public {
        uint256 jobId = _toUnderVerification(true);
        vm.warp(block.timestamp + CHALLENGE_WINDOW);
        latch.finalize(jobId);
        vm.expectRevert(
            abi.encodeWithSelector(LatchJob.InvalidState.selector, LatchJob.State.UnderVerification, LatchJob.State.Released)
        );
        latch.finalize(jobId);
    }

    function test_withdraw_transfersAndClears() public {
        uint256 jobId = _toUnderVerification(true);
        vm.warp(block.timestamp + CHALLENGE_WINDOW);
        latch.finalize(jobId);

        uint256 before = usdc.balanceOf(provider);
        uint256 owed = latch.withdrawable(provider);
        vm.prank(provider);
        latch.withdraw();
        assertEq(usdc.balanceOf(provider), before + owed);
        assertEq(latch.withdrawable(provider), 0);
        _assertSolvent();
    }

    function test_withdraw_revertsWhenNothing() public {
        vm.prank(provider);
        vm.expectRevert(BondModule.NothingToWithdraw.selector);
        latch.withdraw();
    }

    // ---------------------------------------------------------------------
    // Challenge + dispute resolution
    // ---------------------------------------------------------------------

    function _challenge(uint256 jobId, address who, uint256 whoPk) internal {
        bytes32 nonce = latch.challengeNonce(jobId, who);
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(whoPk, who, CHALLENGE_BOND, 0, block.timestamp + 1 hours, nonce);
        // ensure challenger has balance
        usdc.mint(who, CHALLENGE_BOND);
        vm.prank(who);
        latch.challenge(jobId, 0, block.timestamp + 1 hours, v, r, s);
    }

    function test_challenge_movesToDisputed() public {
        uint256 jobId = _toUnderVerification(true);
        _challenge(jobId, buyer, buyerPk);
        LatchJob.Job memory j = latch.getJob(jobId);
        assertEq(uint8(j.state), uint8(LatchJob.State.Disputed));
        assertEq(j.challenger, buyer);
        assertEq(j.challengerBond, CHALLENGE_BOND);
        assertEq(latch.totalBondsLocked(), PROVIDER_BOND + CHALLENGE_BOND);
        _assertSolvent();
    }

    function test_challenge_revertsAfterWindow() public {
        uint256 jobId = _toUnderVerification(true);
        vm.warp(block.timestamp + CHALLENGE_WINDOW);
        bytes32 nonce = latch.challengeNonce(jobId, buyer);
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(buyerPk, buyer, CHALLENGE_BOND, 0, block.timestamp + 1 hours, nonce);
        vm.prank(buyer);
        vm.expectRevert(LatchJob.ChallengeWindowClosed.selector);
        latch.challenge(jobId, 0, block.timestamp + 1 hours, v, r, s);
    }

    function test_challenge_revertsNonParty() public {
        uint256 jobId = _toUnderVerification(true);
        address stranger = makeAddr("stranger");
        (, uint256 strangerPk) = makeAddrAndKey("strangerKey");
        bytes32 nonce = latch.challengeNonce(jobId, stranger);
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(strangerPk, stranger, CHALLENGE_BOND, 0, block.timestamp + 1 hours, nonce);
        vm.prank(stranger);
        vm.expectRevert(LatchJob.NotJobParty.selector);
        latch.challenge(jobId, 0, block.timestamp + 1 hours, v, r, s);
    }

    function test_resolveDispute_upheldPass_slashesChallengerToProvider() public {
        // verdict PASS, buyer grief-challenges, resolver upholds PASS
        uint256 jobId = _toUnderVerification(true);
        _challenge(jobId, buyer, buyerPk);
        vm.prank(disputeResolver);
        latch.resolveDispute(jobId, true);

        uint256 fee = (AMOUNT * FEE_BPS) / 10_000;
        // provider: proceeds + own bond back + slashed challenger bond
        assertEq(latch.withdrawable(provider), AMOUNT - fee + PROVIDER_BOND + CHALLENGE_BOND);
        assertEq(latch.withdrawable(feeRecipient), fee);
        assertEq(latch.withdrawable(buyer), 0); // grief-challenger loses bond
        assertEq(uint8(latch.getJob(jobId).state), uint8(LatchJob.State.Released));
        assertEq(latch.totalBondsLocked(), 0);
        _assertSolvent();
    }

    function test_resolveDispute_overturnPassToFail_refundsAndReturnsChallengerBond() public {
        // verdict PASS, buyer challenges, resolver overturns to FAIL
        uint256 jobId = _toUnderVerification(true);
        _challenge(jobId, buyer, buyerPk);
        vm.prank(disputeResolver);
        latch.resolveDispute(jobId, false);

        // buyer refunded amount + slashed provider bond + challenger bond returned + slashed verifier stake
        assertEq(latch.withdrawable(buyer), AMOUNT + PROVIDER_BOND + CHALLENGE_BOND + SLASH_PER_VERDICT);
        assertEq(latch.withdrawable(provider), 0);
        assertEq(latch.withdrawable(feeRecipient), 0);
        assertEq(latch.verifierStake(verifier), MIN_VERIFIER_STAKE - SLASH_PER_VERDICT, "verifier slashed");
        assertEq(uint8(latch.getJob(jobId).state), uint8(LatchJob.State.Refunded));
        _assertSolvent();
    }

    function test_resolveDispute_overturnFailToPass_paysProviderReturnsChallengerBond() public {
        // verdict FAIL, provider challenges, resolver overturns to PASS
        uint256 jobId = _toUnderVerification(false);
        _challenge(jobId, provider, providerPk);
        vm.prank(disputeResolver);
        latch.resolveDispute(jobId, true);

        uint256 fee = (AMOUNT * FEE_BPS) / 10_000;
        // provider: proceeds + own bond + returned challenger bond + slashed verifier stake
        assertEq(latch.withdrawable(provider), AMOUNT - fee + PROVIDER_BOND + CHALLENGE_BOND + SLASH_PER_VERDICT);
        assertEq(latch.withdrawable(feeRecipient), fee);
        assertEq(latch.withdrawable(buyer), 0);
        assertEq(latch.verifierStake(verifier), MIN_VERIFIER_STAKE - SLASH_PER_VERDICT, "verifier slashed");
        assertEq(uint8(latch.getJob(jobId).state), uint8(LatchJob.State.Released));
        _assertSolvent();
    }

    function test_resolveDispute_revertsNotResolver() public {
        uint256 jobId = _toUnderVerification(true);
        _challenge(jobId, buyer, buyerPk);
        vm.expectRevert(LatchJob.NotDisputeResolver.selector);
        latch.resolveDispute(jobId, true);
    }

    // ---------------------------------------------------------------------
    // Timeouts
    // ---------------------------------------------------------------------

    function test_timeout_fundedProviderNeverAccepts_refundsBuyer() public {
        uint256 jobId = _createJob();
        _fund(jobId);
        vm.prank(buyer);
        latch.timeoutRefund(jobId);
        assertEq(latch.withdrawable(buyer), AMOUNT);
        assertEq(uint8(latch.getJob(jobId).state), uint8(LatchJob.State.Refunded));
        _assertSolvent();
    }

    function test_timeout_inProgressMissedDeadline_refundsAndSlashes() public {
        uint256 jobId = _createJob();
        _fund(jobId);
        _accept(jobId);
        vm.warp(block.timestamp + 2 days); // past submissionDeadline
        vm.prank(buyer);
        latch.timeoutRefund(jobId);
        assertEq(latch.withdrawable(buyer), AMOUNT + PROVIDER_BOND);
        _assertSolvent();
    }

    function test_timeout_inProgressBeforeDeadline_reverts() public {
        uint256 jobId = _createJob();
        _fund(jobId);
        _accept(jobId);
        vm.prank(buyer);
        vm.expectRevert(LatchJob.NotTimedOut.selector);
        latch.timeoutRefund(jobId);
    }

    function test_timeout_submittedVerifierStalls_refundsAndReturnsBond() public {
        uint256 jobId = _createJob();
        _fund(jobId);
        _accept(jobId);
        _submit(jobId);
        vm.warp(block.timestamp + VERDICT_TIMEOUT + 1);
        vm.prank(buyer);
        latch.timeoutRefund(jobId);
        // provider delivered: gets bond back; buyer refunded amount
        assertEq(latch.withdrawable(buyer), AMOUNT);
        assertEq(latch.withdrawable(provider), PROVIDER_BOND);
        _assertSolvent();
    }

    function test_timeout_revertsNonBuyer() public {
        uint256 jobId = _createJob();
        _fund(jobId);
        vm.prank(provider);
        vm.expectRevert(LatchJob.NotBuyer.selector);
        latch.timeoutRefund(jobId);
    }

    // ---------------------------------------------------------------------
    // Admin / auth
    // ---------------------------------------------------------------------

    function test_setVerifierParams_onlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        latch.setVerifierParams(1, 1, 1);
    }

    function test_setProtocolFee_revertsTooHigh() public {
        vm.prank(owner);
        vm.expectRevert(LatchJob.FeeTooHigh.selector);
        latch.setProtocolFee(1001);
    }

    // ---------------------------------------------------------------------
    // Verifier staking
    // ---------------------------------------------------------------------

    function _stakeNew(string memory name) internal returns (address v) {
        v = makeAddr(name);
        usdc.mint(v, MIN_VERIFIER_STAKE);
        vm.startPrank(v);
        usdc.approve(address(latch), MIN_VERIFIER_STAKE);
        latch.stakeVerifier(MIN_VERIFIER_STAKE);
        vm.stopPrank();
    }

    function test_stake_activatesVerifier() public {
        address v2 = makeAddr("v2");
        assertFalse(latch.isActiveVerifier(v2));
        _stakeNew("v2"); // re-derives same address from the label
        assertTrue(latch.isActiveVerifier(v2));
        assertEq(latch.verifierStake(v2), MIN_VERIFIER_STAKE);
        assertEq(latch.totalVerifierStake(), MIN_VERIFIER_STAKE * 2); // base verifier (setUp) + v2
        _assertSolvent();
    }

    function test_stake_belowMinIsInactive() public {
        address v2 = makeAddr("v2");
        usdc.mint(v2, MIN_VERIFIER_STAKE);
        vm.startPrank(v2);
        usdc.approve(address(latch), MIN_VERIFIER_STAKE);
        latch.stakeVerifier(MIN_VERIFIER_STAKE - 1); // one short
        vm.stopPrank();
        assertFalse(latch.isActiveVerifier(v2));
    }

    function test_unstake_deactivates() public {
        vm.prank(verifier);
        latch.unstakeVerifier(MIN_VERIFIER_STAKE);
        assertFalse(latch.isActiveVerifier(verifier));
        assertEq(latch.verifierStake(verifier), 0);
        _assertSolvent();
    }

    function test_unstake_revertsWhileVerdictPending() public {
        _toUnderVerification(true); // verdict posted -> stake locked
        assertEq(latch.pendingVerdicts(verifier), 1);
        vm.prank(verifier);
        vm.expectRevert(LatchJob.StakeLocked.selector);
        latch.unstakeVerifier(MIN_VERIFIER_STAKE);
    }

    function test_pendingVerdict_releasedOnFinalize() public {
        uint256 jobId = _toUnderVerification(true);
        assertEq(latch.pendingVerdicts(verifier), 1);
        vm.warp(block.timestamp + CHALLENGE_WINDOW);
        latch.finalize(jobId);
        assertEq(latch.pendingVerdicts(verifier), 0);
        vm.prank(verifier); // now unlocked
        latch.unstakeVerifier(MIN_VERIFIER_STAKE);
    }

    function test_setVerifierParams_revertsZeroQuorum() public {
        vm.prank(owner);
        vm.expectRevert(LatchJob.InvalidQuorum.selector);
        latch.setVerifierParams(MIN_VERIFIER_STAKE, SLASH_PER_VERDICT, 0);
    }

    // ---------------------------------------------------------------------
    // k-of-n verifier quorum
    // ---------------------------------------------------------------------

    function _stakeFrom(uint256 pk) internal returns (address v) {
        v = vm.addr(pk);
        usdc.mint(v, MIN_VERIFIER_STAKE);
        vm.startPrank(v);
        usdc.approve(address(latch), MIN_VERIFIER_STAKE);
        latch.stakeVerifier(MIN_VERIFIER_STAKE);
        vm.stopPrank();
    }

    function _threeSigs(uint256 jobId, uint256 pkA, uint256 pkB, uint256 pkC, uint256 deadline)
        internal
        view
        returns (bytes[] memory sigs)
    {
        sigs = new bytes[](3);
        sigs[0] = _signVerdict(pkA, jobId, true, 95, keccak256("reason"), "ipfs://e", deadline);
        sigs[1] = _signVerdict(pkB, jobId, true, 95, keccak256("reason"), "ipfs://e", deadline);
        sigs[2] = _signVerdict(pkC, jobId, true, 95, keccak256("reason"), "ipfs://e", deadline);
    }

    function test_quorum_threeSignersSucceeds() public {
        (, uint256 v2pk) = makeAddrAndKey("verifier2");
        (, uint256 v3pk) = makeAddrAndKey("verifier3");
        address v2 = _stakeFrom(v2pk);
        address v3 = _stakeFrom(v3pk);
        vm.prank(owner);
        latch.setVerifierParams(MIN_VERIFIER_STAKE, SLASH_PER_VERDICT, 3);

        uint256 jobId = _createJob();
        _fund(jobId);
        _accept(jobId);
        _submit(jobId);

        uint256 deadline = block.timestamp + 1 hours;
        latch.submitVerdict(jobId, true, 95, keccak256("reason"), "ipfs://e", deadline, _threeSigs(jobId, verifierPk, v2pk, v3pk, deadline));

        LatchJob.Job memory j = latch.getJob(jobId);
        assertEq(uint8(j.state), uint8(LatchJob.State.UnderVerification));
        assertEq(j.verdictSigners.length, 3);
        assertEq(latch.pendingVerdicts(verifier), 1);
        assertEq(latch.pendingVerdicts(v2), 1);
        assertEq(latch.pendingVerdicts(v3), 1);
    }

    function test_quorum_belowQuorumReverts() public {
        vm.prank(owner);
        latch.setVerifierParams(MIN_VERIFIER_STAKE, SLASH_PER_VERDICT, 2);
        uint256 jobId = _createJob();
        _fund(jobId);
        _accept(jobId);
        _submit(jobId);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signVerdict(verifierPk, jobId, true, 95, keccak256("reason"), "ipfs://e", deadline);
        vm.expectRevert(LatchJob.NotEnoughSignatures.selector);
        latch.submitVerdict(jobId, true, 95, keccak256("reason"), "ipfs://e", deadline, _one(sig));
    }

    function test_quorum_duplicateSignerReverts() public {
        uint256 jobId = _createJob();
        _fund(jobId);
        _accept(jobId);
        _submit(jobId);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signVerdict(verifierPk, jobId, true, 95, keccak256("reason"), "ipfs://e", deadline);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = sig;
        sigs[1] = sig; // same signer twice
        vm.expectRevert(LatchJob.DuplicateSigner.selector);
        latch.submitVerdict(jobId, true, 95, keccak256("reason"), "ipfs://e", deadline, sigs);
    }

    function test_quorum_overturnSlashesAllSigners() public {
        (, uint256 v2pk) = makeAddrAndKey("verifier2");
        (, uint256 v3pk) = makeAddrAndKey("verifier3");
        address v2 = _stakeFrom(v2pk);
        address v3 = _stakeFrom(v3pk);
        vm.prank(owner);
        latch.setVerifierParams(MIN_VERIFIER_STAKE, SLASH_PER_VERDICT, 3);

        uint256 jobId = _createJob();
        _fund(jobId);
        _accept(jobId);
        _submit(jobId);
        uint256 deadline = block.timestamp + 1 hours;
        latch.submitVerdict(jobId, true, 95, keccak256("reason"), "ipfs://e", deadline, _threeSigs(jobId, verifierPk, v2pk, v3pk, deadline));

        // buyer challenges, resolver overturns to FAIL -> all three verifiers slashed to the buyer
        _challenge(jobId, buyer, buyerPk);
        vm.prank(disputeResolver);
        latch.resolveDispute(jobId, false);

        assertEq(latch.verifierStake(verifier), MIN_VERIFIER_STAKE - SLASH_PER_VERDICT);
        assertEq(latch.verifierStake(v2), MIN_VERIFIER_STAKE - SLASH_PER_VERDICT);
        assertEq(latch.verifierStake(v3), MIN_VERIFIER_STAKE - SLASH_PER_VERDICT);
        assertEq(latch.withdrawable(buyer), AMOUNT + PROVIDER_BOND + CHALLENGE_BOND + 3 * SLASH_PER_VERDICT);
        _assertSolvent();
    }
}
