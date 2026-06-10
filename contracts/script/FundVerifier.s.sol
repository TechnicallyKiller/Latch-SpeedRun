// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Bootstraps the verifier for the live Fuji committee demo: sends it a little AVAX
///         (gas for approve + stake) from the deployer and enough USDC to stake from the buyer.
///         The demo runner then stakes it. Keeps faucet trips off the critical path.
contract FundVerifier is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 buyerPk = vm.envUint("BUYER_PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address verifier = vm.addr(vm.envUint("VERIFIER_PRIVATE_KEY"));
        uint256 minStake = vm.envOr("MIN_VERIFIER_STAKE", uint256(1000));

        // Gas for the verifier's approve + stakeVerifier transactions.
        vm.startBroadcast(deployerPk);
        (bool ok,) = verifier.call{value: 0.05 ether}("");
        require(ok, "AVAX transfer failed");
        vm.stopBroadcast();

        // USDC for the verifier to stake (a small buffer over the minimum).
        vm.startBroadcast(buyerPk);
        IERC20(usdc).transfer(verifier, minStake);
        vm.stopBroadcast();
    }
}
