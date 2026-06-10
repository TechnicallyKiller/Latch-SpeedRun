// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

import {Test} from "forge-std/Test.sol";
import {LatchJob} from "../src/LatchJob.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// @notice Shared setup + EIP-3009 / EIP-712 signing helpers for the Latch test suite.
abstract contract LatchTestBase is Test {
    LatchJob internal latch;
    MockUSDC internal usdc;

    // actors with known keys (needed to sign authorizations/verdicts)
    address internal buyer;
    uint256 internal buyerPk;
    address internal provider;
    uint256 internal providerPk;
    address internal verifier;
    uint256 internal verifierPk;

    address internal owner = makeAddr("owner");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal disputeResolver = makeAddr("disputeResolver");

    // economics (USDC has 6 decimals)
    uint256 internal constant AMOUNT = 1_000e6;
    uint256 internal constant PROVIDER_BOND = 100e6;
    uint256 internal constant CHALLENGE_BOND = 50e6;
    uint16 internal constant FEE_BPS = 100; // 1%
    uint64 internal constant VERDICT_TIMEOUT = 1 days;
    uint32 internal constant CHALLENGE_WINDOW = 1 hours;
    uint256 internal constant MIN_VERIFIER_STAKE = 1_000e6;
    uint256 internal constant SLASH_PER_VERDICT = 1_000e6;

    bytes32 internal constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 internal constant VERDICT_TYPEHASH = keccak256(
        "Verdict(uint256 jobId,bool pass,uint256 score,bytes32 reasonHash,string evidenceURI,uint256 deadline)"
    );
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    function setUp() public virtual {
        vm.warp(10_000); // move off genesis so validAfter=0 authorizations are valid

        (buyer, buyerPk) = makeAddrAndKey("buyer");
        (provider, providerPk) = makeAddrAndKey("provider");
        (verifier, verifierPk) = makeAddrAndKey("verifier");

        usdc = new MockUSDC();
        latch = new LatchJob(usdc, owner, feeRecipient, disputeResolver, FEE_BPS, CHALLENGE_BOND, VERDICT_TIMEOUT);

        vm.prank(owner);
        latch.setVerifierParams(MIN_VERIFIER_STAKE, SLASH_PER_VERDICT, 1);

        usdc.mint(buyer, 1_000_000e6);
        usdc.mint(provider, 1_000_000e6);

        // The verifier stakes to become active.
        usdc.mint(verifier, MIN_VERIFIER_STAKE);
        vm.startPrank(verifier);
        usdc.approve(address(latch), MIN_VERIFIER_STAKE);
        latch.stakeVerifier(MIN_VERIFIER_STAKE);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------
    // EIP-712 helpers
    // ---------------------------------------------------------------------

    function _domainSeparator(string memory name, string memory version, address verifyingContract)
        internal
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH, keccak256(bytes(name)), keccak256(bytes(version)), block.chainid, verifyingContract
            )
        );
    }

    function _typedDigest(bytes32 domainSep, bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
    }

    /// @dev Sign a USDC receiveWithAuthorization for (from -> latch, value), bound to `nonce`.
    function _signReceive(uint256 fromPk, address from, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash =
            keccak256(abi.encode(RECEIVE_TYPEHASH, from, address(latch), value, validAfter, validBefore, nonce));
        bytes32 digest = _typedDigest(_domainSeparator("USD Coin", "2", address(usdc)), structHash);
        (v, r, s) = vm.sign(fromPk, digest);
    }

    /// @dev Sign a verifier verdict for `jobId`.
    function _signVerdict(
        uint256 signerPk,
        uint256 jobId,
        bool pass,
        uint256 score,
        bytes32 reasonHash,
        string memory evidenceURI,
        uint256 deadline
    ) internal view returns (bytes memory sig) {
        bytes32 structHash = keccak256(
            abi.encode(VERDICT_TYPEHASH, jobId, pass, score, reasonHash, keccak256(bytes(evidenceURI)), deadline)
        );
        bytes32 digest = _typedDigest(_domainSeparator("Latch", "1", address(latch)), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        sig = abi.encodePacked(r, s, v);
    }

    // ---------------------------------------------------------------------
    // Lifecycle helpers
    // ---------------------------------------------------------------------

    /// @dev Wrap a single signature in the bytes[] expected by submitVerdict (quorum 1).
    function _one(bytes memory sig) internal pure returns (bytes[] memory arr) {
        arr = new bytes[](1);
        arr[0] = sig;
    }

    function _createJob() internal returns (uint256 jobId) {
        vm.prank(buyer);
        jobId = latch.createJob(
            provider,
            AMOUNT,
            PROVIDER_BOND,
            keccak256("policy"),
            0,
            uint64(block.timestamp + 1 days),
            CHALLENGE_WINDOW
        );
    }

    function _fund(uint256 jobId) internal {
        bytes32 nonce = latch.escrowNonce(jobId);
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(buyerPk, buyer, AMOUNT, 0, block.timestamp + 1 hours, nonce);
        latch.fundJob(jobId, 0, block.timestamp + 1 hours, v, r, s);
    }

    function _accept(uint256 jobId) internal {
        bytes32 nonce = latch.bondNonce(jobId);
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(providerPk, provider, PROVIDER_BOND, 0, block.timestamp + 1 hours, nonce);
        vm.prank(provider);
        latch.acceptJob(jobId, 0, block.timestamp + 1 hours, v, r, s);
    }

    function _submit(uint256 jobId) internal {
        vm.prank(provider);
        latch.submitDeliverable(jobId, keccak256("deliverable"));
    }

    function _postVerdict(uint256 jobId, bool pass) internal {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signVerdict(verifierPk, jobId, pass, pass ? 95 : 10, keccak256("reason"), "ipfs://evidence", deadline);
        latch.submitVerdict(jobId, pass, pass ? 95 : 10, keccak256("reason"), "ipfs://evidence", deadline, _one(sig));
    }

    /// @dev Drive a job to UnderVerification with the given verdict.
    function _toUnderVerification(bool pass) internal returns (uint256 jobId) {
        jobId = _createJob();
        _fund(jobId);
        _accept(jobId);
        _submit(jobId);
        _postVerdict(jobId, pass);
    }

    /// @dev Solvency invariant check usable from any test.
    function _assertSolvent() internal view {
        assertGe(
            usdc.balanceOf(address(latch)),
            latch.totalEscrowed() + latch.totalBondsLocked() + latch.totalWithdrawable() + latch.totalVerifierStake(),
            "insolvent: balance < escrow + bonds + withdrawable + verifierStake"
        );
    }
}
