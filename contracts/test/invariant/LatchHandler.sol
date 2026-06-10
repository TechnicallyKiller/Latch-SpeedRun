// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

import {Test} from "forge-std/Test.sol";
import {LatchJob} from "../../src/LatchJob.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";

/// @notice Stateful handler driving random-but-valid LatchJob action sequences for invariant runs.
///         Each action targets an existing job in an appropriate state; invalid attempts are
///         swallowed (the invariant config runs with fail_on_revert = false).
contract LatchHandler is Test {
    LatchJob internal latch;
    MockUSDC internal usdc;

    address internal buyer;
    uint256 internal buyerPk;
    address internal provider;
    uint256 internal providerPk;
    address internal verifier;
    uint256 internal verifierPk;
    address internal resolver;

    uint256[] public jobIds;

    bytes32 internal constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 internal constant VERDICT_TYPEHASH = keccak256(
        "Verdict(uint256 jobId,bool pass,uint256 score,bytes32 reasonHash,string evidenceURI,uint256 deadline)"
    );
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    constructor(
        LatchJob _latch,
        MockUSDC _usdc,
        address _buyer,
        uint256 _buyerPk,
        address _provider,
        uint256 _providerPk,
        address _verifier,
        uint256 _verifierPk,
        address _resolver
    ) {
        latch = _latch;
        usdc = _usdc;
        buyer = _buyer;
        buyerPk = _buyerPk;
        provider = _provider;
        providerPk = _providerPk;
        verifier = _verifier;
        verifierPk = _verifierPk;
        resolver = _resolver;

        usdc.mint(buyer, type(uint128).max);
        usdc.mint(provider, type(uint128).max);
    }

    function jobIdCount() external view returns (uint256) {
        return jobIds.length;
    }

    // ---- signing helpers (mirror the contracts' EIP-712 domains) ----

    function _domSep(string memory n, string memory ver, address c) internal view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(n)), keccak256(bytes(ver)), block.chainid, c));
    }

    function _signRecv(uint256 pk, address from, uint256 value, bytes32 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 sh =
            keccak256(abi.encode(RECEIVE_TYPEHASH, from, address(latch), value, uint256(0), block.timestamp + 1 hours, nonce));
        (v, r, s) = vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", _domSep("USD Coin", "2", address(usdc)), sh)));
    }

    function _signVerd(uint256 pk, uint256 jobId, bool pass) internal view returns (bytes memory) {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 sh = keccak256(
            abi.encode(VERDICT_TYPEHASH, jobId, pass, pass ? uint256(100) : 0, keccak256("r"), keccak256(bytes("ipfs://e")), deadline)
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", _domSep("Latch", "1", address(latch)), sh)));
        return abi.encodePacked(r, s, v);
    }

    function _pick(uint256 seed) internal view returns (uint256 jobId, bool ok) {
        if (jobIds.length == 0) return (0, false);
        return (jobIds[seed % jobIds.length], true);
    }

    // ---- actions ----

    function createJob(uint256 amount, uint256 bond) public {
        amount = bound(amount, 1, 1e12);
        bond = bound(bond, 0, 1e12);
        vm.prank(buyer);
        try latch.createJob(provider, amount, bond, keccak256("p"), 0, uint64(block.timestamp + 1 days), uint32(1 hours))
        returns (uint256 id) {
            jobIds.push(id);
        } catch {}
    }

    function fund(uint256 seed) public {
        (uint256 jobId, bool ok) = _pick(seed);
        if (!ok) return;
        LatchJob.Job memory j = latch.getJob(jobId);
        if (j.state != LatchJob.State.Created) return;
        (uint8 v, bytes32 r, bytes32 s) = _signRecv(buyerPk, buyer, j.amount, latch.escrowNonce(jobId));
        try latch.fundJob(jobId, 0, block.timestamp + 1 hours, v, r, s) {} catch {}
    }

    function accept(uint256 seed) public {
        (uint256 jobId, bool ok) = _pick(seed);
        if (!ok) return;
        LatchJob.Job memory j = latch.getJob(jobId);
        if (j.state != LatchJob.State.Funded) return;
        (uint8 v, bytes32 r, bytes32 s) = _signRecv(providerPk, provider, j.providerBond, latch.bondNonce(jobId));
        vm.prank(provider);
        try latch.acceptJob(jobId, 0, block.timestamp + 1 hours, v, r, s) {} catch {}
    }

    function submit(uint256 seed) public {
        (uint256 jobId, bool ok) = _pick(seed);
        if (!ok) return;
        vm.prank(provider);
        try latch.submitDeliverable(jobId, keccak256("d")) {} catch {}
    }

    function verdict(uint256 seed, bool pass) public {
        (uint256 jobId, bool ok) = _pick(seed);
        if (!ok) return;
        LatchJob.Job memory j = latch.getJob(jobId);
        if (j.state != LatchJob.State.Submitted) return;
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signVerd(verifierPk, jobId, pass);
        try latch.submitVerdict(jobId, pass, pass ? 100 : 0, keccak256("r"), "ipfs://e", block.timestamp + 1 hours, sigs) {} catch {}
    }

    function warpTime(uint256 t) public {
        vm.warp(block.timestamp + bound(t, 1, 2 hours));
    }

    function finalize(uint256 seed) public {
        (uint256 jobId, bool ok) = _pick(seed);
        if (!ok) return;
        try latch.finalize(jobId) {} catch {}
    }

    function challengeJob(uint256 seed, bool byBuyer) public {
        (uint256 jobId, bool ok) = _pick(seed);
        if (!ok) return;
        LatchJob.Job memory j = latch.getJob(jobId);
        if (j.state != LatchJob.State.UnderVerification) return;
        address who = byBuyer ? buyer : provider;
        uint256 pk = byBuyer ? buyerPk : providerPk;
        (uint8 v, bytes32 r, bytes32 s) = _signRecv(pk, who, latch.challengeBondAmount(), latch.challengeNonce(jobId, who));
        vm.prank(who);
        try latch.challenge(jobId, 0, block.timestamp + 1 hours, v, r, s) {} catch {}
    }

    function resolve(uint256 seed, bool pass) public {
        (uint256 jobId, bool ok) = _pick(seed);
        if (!ok) return;
        vm.prank(resolver);
        try latch.resolveDispute(jobId, pass) {} catch {}
    }

    function timeout(uint256 seed) public {
        (uint256 jobId, bool ok) = _pick(seed);
        if (!ok) return;
        vm.prank(buyer);
        try latch.timeoutRefund(jobId) {} catch {}
    }

    function withdrawAll() public {
        address[3] memory who = [buyer, provider, latch.feeRecipient()];
        for (uint256 i; i < who.length; i++) {
            vm.prank(who[i]);
            try latch.withdraw() {} catch {}
        }
    }
}
