// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

import {Script, console2} from "forge-std/Script.sol";
import {LatchJob} from "../src/LatchJob.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploys LatchJob to Fuji against the real USDC and registers the verifier key.
///         Env (sourced from the repo-root .env): DEPLOYER_PRIVATE_KEY, USDC_ADDRESS,
///         VERIFIER_PRIVATE_KEY, PROTOCOL_FEE_BPS, CHALLENGE_BOND.
contract DeployFuji is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address verifier = vm.addr(vm.envUint("VERIFIER_PRIVATE_KEY"));
        uint16 feeBps = uint16(vm.envUint("PROTOCOL_FEE_BPS"));
        uint256 challengeBond = vm.envUint("CHALLENGE_BOND");
        address deployer = vm.addr(deployerPk);

        // Verifier-set params (defaults keep testnet staking tiny; verifiers self-stake afterward).
        uint256 minStake = vm.envOr("MIN_VERIFIER_STAKE", uint256(1000));
        uint256 slashAmount = vm.envOr("SLASH_PER_VERDICT", uint256(1000));
        uint256 quorum = vm.envOr("VERDICT_QUORUM", uint256(1));

        vm.startBroadcast(deployerPk);
        LatchJob latch = new LatchJob(
            IERC20(usdc),
            deployer, // owner
            deployer, // feeRecipient (v0)
            deployer, // disputeResolver (v0 multisig stand-in)
            feeBps,
            challengeBond,
            1 days // verdictTimeout
        );
        latch.setVerifierParams(minStake, slashAmount, quorum);
        vm.stopBroadcast();

        console2.log("LATCHJOB_ADDRESS=%s", address(latch));
        console2.log("VERIFIER=%s", verifier);
        console2.log("USDC=%s", usdc);
    }
}
