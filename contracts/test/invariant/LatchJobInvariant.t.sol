// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

import {LatchTestBase} from "../Base.t.sol";
import {LatchJob} from "../../src/LatchJob.sol";
import {LatchHandler} from "./LatchHandler.sol";

/// @notice Fund-safety invariants over arbitrary action sequences.
contract LatchJobInvariantTest is LatchTestBase {
    LatchHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new LatchHandler(
            latch, usdc, buyer, buyerPk, provider, providerPk, verifier, verifierPk, disputeResolver
        );
        targetContract(address(handler));
    }

    /// @dev The contract is always solvent: its token balance covers everything it owes.
    function invariant_solvency() public view {
        assertGe(
            usdc.balanceOf(address(latch)),
            latch.totalEscrowed() + latch.totalBondsLocked() + latch.totalWithdrawable(),
            "insolvent"
        );
    }

    /// @dev totalEscrowed always equals the sum of amounts over funded-but-unsettled jobs.
    function invariant_escrowMatchesActiveJobs() public view {
        uint256 sum;
        uint256 n = handler.jobIdCount();
        for (uint256 i; i < n; i++) {
            LatchJob.Job memory j = latch.getJob(handler.jobIds(i));
            LatchJob.State st = j.state;
            if (
                st == LatchJob.State.Funded || st == LatchJob.State.InProgress || st == LatchJob.State.Submitted
                    || st == LatchJob.State.UnderVerification || st == LatchJob.State.Disputed
            ) {
                sum += j.amount;
            }
        }
        assertEq(sum, latch.totalEscrowed(), "escrow accounting drift");
    }

    /// @dev totalBondsLocked always equals provider bonds on live jobs + challenger bonds on disputes.
    function invariant_bondsMatchActiveJobs() public view {
        uint256 sum;
        uint256 n = handler.jobIdCount();
        for (uint256 i; i < n; i++) {
            LatchJob.Job memory j = latch.getJob(handler.jobIds(i));
            LatchJob.State st = j.state;
            if (
                st == LatchJob.State.InProgress || st == LatchJob.State.Submitted
                    || st == LatchJob.State.UnderVerification || st == LatchJob.State.Disputed
            ) {
                sum += j.providerBond;
            }
            if (st == LatchJob.State.Disputed) {
                sum += j.challengerBond;
            }
        }
        assertEq(sum, latch.totalBondsLocked(), "bond accounting drift");
    }

    /// @dev Every job that ever existed is in a valid (non-None) state.
    function invariant_noLostJobs() public view {
        uint256 n = handler.jobIdCount();
        for (uint256 i; i < n; i++) {
            assertTrue(latch.getJob(handler.jobIds(i)).state != LatchJob.State.None, "job fell back to None");
        }
    }
}
