// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {BondModule} from "./BondModule.sol";
import {IERC3009} from "./interfaces/IERC3009.sol";
import {IReputationRegistry, IValidationRegistry} from "./interfaces/IERC8004.sol";

/// @title LatchJob
/// @author Latch
/// @notice ERC-8183-compatible escrow for agent commerce with a verifier-driven, optimistic
///         settlement loop. A buyer funds a USDC escrow (self-redeemed EIP-3009 — Latch is its
///         own x402 settlement target, no trusted facilitator), a provider posts a bond and
///         submits a deliverable, a registered verifier posts a signed correctness verdict, and
///         after a short challenge window (justified by Avalanche's ~1s finality) the escrow
///         releases to the provider or refunds the buyer. Challenges route to a dispute resolver.
/// @dev Lifecycle: Created -> Funded -> InProgress -> Submitted -> UnderVerification ->
///      {Released | Refunded | Disputed}; Disputed -> {Released | Refunded}.
///      The verifier set and the dispute resolver are swappable addresses: the designed
///      trajectory replaces the single verifier key with a staked verifier set (AVS) and the
///      multisig resolver with staked jurors — a drop-in, not a rewrite.
contract LatchJob is BondModule, Ownable, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum State {
        None, // 0: job does not exist
        Created, // 1: terms set, not yet funded
        Funded, // 2: escrow funded by buyer
        InProgress, // 3: provider accepted + bonded
        Submitted, // 4: deliverable submitted, awaiting verdict
        UnderVerification, // 5: verdict posted, challenge window open
        Released, // 6: terminal — paid provider
        Refunded, // 7: terminal — refunded buyer
        Disputed // 8: challenge raised, awaiting resolution
    }

    struct Job {
        address buyer;
        address provider;
        address challenger; // set when challenged
        uint256 amount; // escrowed USDC
        uint256 providerBond; // bond locked when provider accepts
        uint256 challengerBond; // bond locked when challenged
        uint256 verdictScore; // score reported by the verifier
        uint256 providerAgentId; // ERC-8004 identity id of provider (0 if unset)
        bytes32 policyCommitment; // opaque hash binding the VerificationPolicy (+ ground-truth hash)
        bytes32 submissionHash; // hash of the submitted deliverable
        bytes32 reasonHash; // verdict reason hash -> ERC-8004 reputation/validation
        uint16 protocolFeeBps; // fee snapshot at creation
        uint64 submissionDeadline; // provider must submit by this timestamp
        uint64 submittedAt; // timestamp the deliverable was submitted
        uint64 verdictTime; // timestamp the verdict was posted
        uint32 challengeWindow; // seconds the optimistic window stays open
        bool verdictPass; // verdict outcome
        State state;
        address[] verdictSigners; // the staked verifiers who co-signed the recorded verdict
    }

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    uint16 public constant MAX_FEE_BPS = 1000; // 10% ceiling on the protocol fee
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint32 public constant MIN_CHALLENGE_WINDOW = 30; // seconds (fast finality permits short windows)
    uint32 public constant MAX_CHALLENGE_WINDOW = 7 days;

    // EIP-3009 nonce domains — bind a buyer/provider/challenger authorization to a specific jobId.
    bytes32 private constant FUND_ESCROW = keccak256("LATCH_FUND_ESCROW");
    bytes32 private constant FUND_BOND = keccak256("LATCH_FUND_BOND");
    bytes32 private constant FUND_CHALLENGE = keccak256("LATCH_FUND_CHALLENGE");

    bytes32 private constant VERDICT_TYPEHASH = keccak256(
        "Verdict(uint256 jobId,bool pass,uint256 score,bytes32 reasonHash,string evidenceURI,uint256 deadline)"
    );

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice The escrowed token (USDC) — must support EIP-3009 receiveWithAuthorization.
    IERC20 public immutable token;

    /// @notice Sum of escrow amounts for jobs that are funded but not yet settled.
    uint256 public totalEscrowed;

    /// @notice Monotonic job id counter; ids start at 1.
    uint256 public jobCount;

    mapping(uint256 jobId => Job) private _jobs;

    /// @notice Verifier stake, denominated in the escrow token. A verifier is *active* (allowed
    ///         to sign verdicts) iff its stake is at least {minVerifierStake}. This is the staked
    ///         verifier set: skin in the game, slashable on a proven-wrong verdict.
    mapping(address verifier => uint256) public verifierStake;

    /// @notice Total verifier stake held by the contract (part of the solvency invariant).
    uint256 public totalVerifierStake;

    /// @notice Count of unsettled verdicts a verifier has signed. Stake is locked while > 0, so a
    ///         verifier cannot sign a verdict and then unstake to dodge slashing.
    mapping(address verifier => uint256) public pendingVerdicts;

    /// @notice Minimum stake to be an active verifier (0 = no active verifiers; must be set).
    uint256 public minVerifierStake;

    /// @notice Stake slashed from each signer of a verdict that a dispute overturns.
    uint256 public slashPerVerdict;

    /// @notice Verifier signatures required to record a verdict (k-of-n). Defaults to 1.
    uint256 public verdictQuorum;

    /// @notice Final arbiter for challenged jobs (v0: a multisig; later a staked juror set).
    address public disputeResolver;

    /// @notice Recipient of protocol fees on successful release.
    address public feeRecipient;

    /// @notice Default protocol fee (bps) snapshotted into each job at creation.
    uint16 public defaultProtocolFeeBps;

    /// @notice Flat bond a challenger must post to dispute a verdict.
    uint256 public challengeBondAmount;

    /// @notice If the verifier does not post a verdict within this window after submission, the
    ///         buyer may reclaim the escrow (provider, having delivered, gets its bond back).
    uint64 public verdictTimeout;

    /// @notice Optional ERC-8004 registries (wired in build-order step 5; calls are guarded).
    IReputationRegistry public reputationRegistry;
    IValidationRegistry public validationRegistry;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event JobCreated(
        uint256 indexed jobId,
        address indexed buyer,
        address indexed provider,
        uint256 amount,
        uint256 providerBond,
        bytes32 policyCommitment
    );
    event JobFunded(uint256 indexed jobId, address indexed buyer, uint256 amount);
    event JobAccepted(uint256 indexed jobId, address indexed provider, uint256 providerBond);
    event DeliverableSubmitted(uint256 indexed jobId, address indexed provider, bytes32 submissionHash);
    event VerdictSubmitted(
        uint256 indexed jobId,
        bool pass,
        uint256 score,
        bytes32 reasonHash,
        string evidenceURI,
        uint256 signerCount
    );
    event JobChallenged(uint256 indexed jobId, address indexed challenger, uint256 bond);
    event DisputeResolved(uint256 indexed jobId, bool finalPass, bool verdictUpheld, address indexed challenger);
    event JobSettled(uint256 indexed jobId, bool pass, uint256 providerProceeds, uint256 fee, bytes32 reasonHash);
    event JobTimedOut(uint256 indexed jobId, State fromState);

    // verifier staking
    event VerifierStaked(address indexed verifier, uint256 amount, uint256 totalStake);
    event VerifierUnstaked(address indexed verifier, uint256 amount, uint256 totalStake);
    event VerifierSlashed(uint256 indexed jobId, address indexed verifier, uint256 amount, address indexed beneficiary);
    event VerifierParamsSet(uint256 minStake, uint256 slashPerVerdict, uint256 quorum);

    // config events
    event DisputeResolverSet(address indexed resolver);
    event FeeRecipientSet(address indexed recipient);
    event ProtocolFeeSet(uint16 bps);
    event ChallengeBondSet(uint256 amount);
    event VerdictTimeoutSet(uint64 timeout);
    event RegistriesSet(address reputation, address validation);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error InvalidAmount();
    error InvalidState(State expected, State actual);
    error NotJobParty();
    error NotBuyer();
    error NotProvider();
    error NotDisputeResolver();
    error StakeLocked();
    error InvalidQuorum();
    error InvalidVerifierSignature();
    error NotEnoughSignatures();
    error DuplicateSigner();
    error VerdictExpired();
    error DeadlinePassed();
    error InvalidChallengeWindow();
    error FeeTooHigh();
    error ChallengeWindowOpen();
    error ChallengeWindowClosed();
    error VerdictNotTimedOut();
    error NotTimedOut();
    error FundingAmountMismatch();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(
        IERC20 token_,
        address owner_,
        address feeRecipient_,
        address disputeResolver_,
        uint16 defaultProtocolFeeBps_,
        uint256 challengeBondAmount_,
        uint64 verdictTimeout_
    ) Ownable(owner_) EIP712("Latch", "1") {
        if (address(token_) == address(0) || feeRecipient_ == address(0) || disputeResolver_ == address(0)) {
            revert ZeroAddress();
        }
        if (defaultProtocolFeeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        token = token_;
        feeRecipient = feeRecipient_;
        disputeResolver = disputeResolver_;
        defaultProtocolFeeBps = defaultProtocolFeeBps_;
        challengeBondAmount = challengeBondAmount_;
        verdictTimeout = verdictTimeout_;
        verdictQuorum = 1;
        // minVerifierStake stays 0 until setVerifierParams is called, so the owner must explicitly
        // open the verifier set (no verifier is active while minVerifierStake == 0).
    }

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier onlyDisputeResolver() {
        if (msg.sender != disputeResolver) revert NotDisputeResolver();
        _;
    }

    // ---------------------------------------------------------------------
    // Job lifecycle
    // ---------------------------------------------------------------------

    /// @notice Create a job with agreed terms. Provider selection/pricing happens off-chain
    ///         (agents discover via ERC-8004); the chosen provider is bound here.
    function createJob(
        address provider,
        uint256 amount,
        uint256 providerBond,
        bytes32 policyCommitment,
        uint256 providerAgentId,
        uint64 submissionDeadline,
        uint32 challengeWindow
    ) external returns (uint256 jobId) {
        if (provider == address(0)) revert ZeroAddress();
        if (provider == msg.sender) revert NotJobParty();
        if (amount == 0) revert InvalidAmount();
        if (submissionDeadline <= block.timestamp) revert DeadlinePassed();
        if (challengeWindow < MIN_CHALLENGE_WINDOW || challengeWindow > MAX_CHALLENGE_WINDOW) {
            revert InvalidChallengeWindow();
        }

        jobId = ++jobCount;
        Job storage j = _jobs[jobId];
        j.buyer = msg.sender;
        j.provider = provider;
        j.amount = amount;
        j.providerBond = providerBond;
        j.providerAgentId = providerAgentId;
        j.policyCommitment = policyCommitment;
        j.protocolFeeBps = defaultProtocolFeeBps;
        j.submissionDeadline = submissionDeadline;
        j.challengeWindow = challengeWindow;
        j.state = State.Created;

        emit JobCreated(jobId, msg.sender, provider, amount, providerBond, policyCommitment);
    }

    /// @notice Fund the escrow by redeeming the buyer's EIP-3009 authorization. The signed nonce
    ///         is bound to this jobId (see {escrowNonce}), so the authorization cannot be rebound
    ///         to another job by a front-runner. `receiveWithAuthorization` requires `to` == this
    ///         contract, so only this escrow can redeem it.
    function fundJob(uint256 jobId, uint256 validAfter, uint256 validBefore, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
    {
        Job storage j = _jobs[jobId];
        _expectState(j, State.Created);

        uint256 amount = j.amount;
        bytes32 nonce = _authNonce(FUND_ESCROW, jobId, j.buyer);

        // Effects before interaction; the funds pull below must succeed or the whole tx reverts.
        j.state = State.Funded;
        totalEscrowed += amount;

        uint256 balanceBefore = token.balanceOf(address(this));
        IERC3009(address(token)).receiveWithAuthorization(
            j.buyer, address(this), amount, validAfter, validBefore, nonce, v, r, s
        );
        if (token.balanceOf(address(this)) - balanceBefore != amount) revert FundingAmountMismatch();

        emit JobFunded(jobId, j.buyer, amount);
    }

    /// @notice Provider accepts the job by posting its bond (also via EIP-3009, approval-free).
    function acceptJob(uint256 jobId, uint256 validAfter, uint256 validBefore, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
    {
        Job storage j = _jobs[jobId];
        _expectState(j, State.Funded);
        if (msg.sender != j.provider) revert NotProvider();

        uint256 bond = j.providerBond;
        j.state = State.InProgress;

        if (bond > 0) {
            _lockBond(bond); // effect before interaction (CEI)
            bytes32 nonce = _authNonce(FUND_BOND, jobId, j.provider);
            uint256 balanceBefore = token.balanceOf(address(this));
            IERC3009(address(token)).receiveWithAuthorization(
                j.provider, address(this), bond, validAfter, validBefore, nonce, v, r, s
            );
            if (token.balanceOf(address(this)) - balanceBefore != bond) revert FundingAmountMismatch();
        }

        emit JobAccepted(jobId, j.provider, bond);
    }

    /// @notice Provider submits the deliverable (referenced by hash; payload lives off-chain).
    function submitDeliverable(uint256 jobId, bytes32 submissionHash) external {
        Job storage j = _jobs[jobId];
        _expectState(j, State.InProgress);
        if (msg.sender != j.provider) revert NotProvider();
        if (block.timestamp > j.submissionDeadline) revert DeadlinePassed();

        j.submissionHash = submissionHash;
        j.submittedAt = uint64(block.timestamp);
        j.state = State.Submitted;

        emit DeliverableSubmitted(jobId, j.provider, submissionHash);
    }

    /// @notice Record a verifier's signed correctness verdict and open the challenge window.
    /// @dev Authorization is the EIP-712 signature (relayer-friendly); only a valid signature
    ///      from the job's registered verifier advances the job to UnderVerification.
    /// @dev Records a verdict co-signed by a quorum of the staked verifier set. Because
    ///      verification is deterministic, honest verifiers produce byte-identical verdicts and
    ///      sign the same EIP-712 digest, so their signatures are simply collected here. Each
    ///      signer must be a distinct active (staked) verifier; their stake locks until settlement.
    function submitVerdict(
        uint256 jobId,
        bool pass,
        uint256 score,
        bytes32 reasonHash,
        string calldata evidenceURI,
        uint256 deadline,
        bytes[] calldata sigs
    ) external {
        Job storage j = _jobs[jobId];
        _expectState(j, State.Submitted);
        if (block.timestamp > deadline) revert VerdictExpired();
        if (sigs.length < verdictQuorum) revert NotEnoughSignatures();

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(VERDICT_TYPEHASH, jobId, pass, score, reasonHash, keccak256(bytes(evidenceURI)), deadline))
        );

        for (uint256 i = 0; i < sigs.length; i++) {
            address signer = ECDSA.recover(digest, sigs[i]);
            if (!isActiveVerifier(signer)) revert InvalidVerifierSignature();
            for (uint256 k = 0; k < j.verdictSigners.length; k++) {
                if (j.verdictSigners[k] == signer) revert DuplicateSigner();
            }
            j.verdictSigners.push(signer);
            pendingVerdicts[signer] += 1; // lock stake until settled
        }

        j.verdictPass = pass;
        j.verdictScore = score;
        j.reasonHash = reasonHash;
        j.verdictTime = uint64(block.timestamp);
        j.state = State.UnderVerification;

        emit VerdictSubmitted(jobId, pass, score, reasonHash, evidenceURI, sigs.length);
    }

    /// @notice Optimistically finalize after the challenge window elapses with no challenge.
    function finalize(uint256 jobId) external nonReentrant {
        Job storage j = _jobs[jobId];
        _expectState(j, State.UnderVerification);
        if (block.timestamp < uint256(j.verdictTime) + j.challengeWindow) revert ChallengeWindowOpen();

        bool pass = j.verdictPass;
        _settle(jobId, j, pass);
        _resolveVerdictStake(jobId, j, false, address(0)); // unchallenged verdict: unlock, no slash
        _writeReputationAndValidation(j, pass); // external call last (CEI)
    }

    /// @notice Challenge a posted verdict within the window by posting a bond (EIP-3009).
    /// @dev Standing is limited to the two job parties (buyer or provider).
    function challenge(uint256 jobId, uint256 validAfter, uint256 validBefore, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
    {
        Job storage j = _jobs[jobId];
        _expectState(j, State.UnderVerification);
        if (block.timestamp >= uint256(j.verdictTime) + j.challengeWindow) revert ChallengeWindowClosed();
        if (msg.sender != j.buyer && msg.sender != j.provider) revert NotJobParty();

        uint256 bond = challengeBondAmount;
        j.challenger = msg.sender;
        j.challengerBond = bond;
        j.state = State.Disputed;

        if (bond > 0) {
            _lockBond(bond); // effect before interaction (CEI)
            bytes32 nonce = _authNonce(FUND_CHALLENGE, jobId, msg.sender);
            uint256 balanceBefore = token.balanceOf(address(this));
            IERC3009(address(token)).receiveWithAuthorization(
                msg.sender, address(this), bond, validAfter, validBefore, nonce, v, r, s
            );
            if (token.balanceOf(address(this)) - balanceBefore != bond) revert FundingAmountMismatch();
        }

        emit JobChallenged(jobId, msg.sender, bond);
    }

    /// @notice Resolve a disputed job. Settles per `finalPass`, then distributes the challenger
    ///         bond: returned if the challenge succeeded (verdict overturned), otherwise slashed
    ///         to the counterparty that the upheld verdict favors.
    /// @dev An overturned verdict slashes the verifier's staked collateral to the wronged party;
    ///      an upheld verdict simply unlocks the stake.
    function resolveDispute(uint256 jobId, bool finalPass) external nonReentrant onlyDisputeResolver {
        Job storage j = _jobs[jobId];
        _expectState(j, State.Disputed);

        bool upheld = (finalPass == j.verdictPass);
        address challenger = j.challenger;
        uint256 cBond = j.challengerBond;

        _settle(jobId, j, finalPass);

        if (cBond > 0) {
            _releaseBond(cBond);
            if (upheld) {
                // Failed challenge: slash challenger bond to the party the verdict favors.
                _credit(finalPass ? j.provider : j.buyer, cBond);
            } else {
                // Successful challenge: return the challenger's bond.
                _credit(challenger, cBond);
            }
        }

        // Slash the verifier's stake on an overturned verdict; just unlock it if upheld.
        _resolveVerdictStake(jobId, j, !upheld, finalPass ? j.provider : j.buyer);

        emit DisputeResolved(jobId, finalPass, upheld, challenger);
        _writeReputationAndValidation(j, finalPass); // external call last (CEI)
    }

    /// @notice Reclaim escrow when the counterparty stalls. Handles three timeout cases:
    ///         (1) Funded but provider never accepted -> refund buyer;
    ///         (2) InProgress but provider missed the submission deadline -> refund buyer + slash provider bond;
    ///         (3) Submitted but verifier never posted a verdict within {verdictTimeout} ->
    ///             refund buyer and return the provider's bond (provider delivered; verifier stalled).
    function timeoutRefund(uint256 jobId) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (msg.sender != j.buyer) revert NotBuyer();

        State from = j.state;
        if (from == State.Funded) {
            totalEscrowed -= j.amount;
            _credit(j.buyer, j.amount);
            j.state = State.Refunded;
        } else if (from == State.InProgress) {
            if (block.timestamp <= j.submissionDeadline) revert NotTimedOut();
            totalEscrowed -= j.amount;
            _credit(j.buyer, j.amount);
            if (j.providerBond > 0) {
                _releaseBond(j.providerBond);
                _credit(j.buyer, j.providerBond); // ghosting provider's bond compensates the buyer
            }
            j.state = State.Refunded;
        } else if (from == State.Submitted) {
            if (block.timestamp <= uint256(j.submittedAt) + verdictTimeout) revert VerdictNotTimedOut();
            totalEscrowed -= j.amount;
            _credit(j.buyer, j.amount);
            if (j.providerBond > 0) {
                _releaseBond(j.providerBond);
                _credit(j.provider, j.providerBond); // provider delivered; return its bond
            }
            j.state = State.Refunded;
        } else {
            revert InvalidState(State.Submitted, from);
        }

        emit JobTimedOut(jobId, from);
    }

    /// @notice Pull the caller's full withdrawable balance (settled proceeds, refunds, bonds).
    /// @dev Guarded entry point over {BondModule-_withdraw}; the ledger is zeroed before payout.
    function withdraw() external nonReentrant returns (uint256 amount) {
        amount = _withdraw(msg.sender);
    }

    // ---------------------------------------------------------------------
    // Verifier staking (the staked verifier set)
    // ---------------------------------------------------------------------

    /// @notice A verifier is active (eligible to sign verdicts) iff it has staked at least
    ///         {minVerifierStake}. minVerifierStake == 0 means the set is closed.
    function isActiveVerifier(address verifier) public view returns (bool) {
        return minVerifierStake > 0 && verifierStake[verifier] >= minVerifierStake;
    }

    /// @notice Stake the escrow token to join the verifier set. Requires a prior ERC-20 approval.
    function stakeVerifier(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        // Effects before interaction; a failed/short transfer reverts the whole tx.
        verifierStake[msg.sender] += amount;
        totalVerifierStake += amount;

        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - balanceBefore != amount) revert FundingAmountMismatch();

        emit VerifierStaked(msg.sender, amount, verifierStake[msg.sender]);
    }

    /// @notice Withdraw stake. Blocked while the verifier has any unsettled verdict (no dodging slashes).
    function unstakeVerifier(uint256 amount) external nonReentrant {
        if (pendingVerdicts[msg.sender] != 0) revert StakeLocked();
        uint256 staked = verifierStake[msg.sender];
        if (amount == 0 || amount > staked) revert InvalidAmount();

        verifierStake[msg.sender] = staked - amount;
        totalVerifierStake -= amount;
        token.safeTransfer(msg.sender, amount);

        emit VerifierUnstaked(msg.sender, amount, verifierStake[msg.sender]);
    }

    // ---------------------------------------------------------------------
    // Internal settlement
    // ---------------------------------------------------------------------

    /// @dev Settle a job's escrow + provider bond + state for a given outcome. Pure state
    ///      mutation: the caller performs any challenger-bond distribution and the ERC-8004
    ///      external writes *after* this returns, so every external call stays last (CEI).
    function _settle(uint256 jobId, Job storage j, bool pass) internal {
        uint256 amount = j.amount;
        uint256 pBond = j.providerBond;
        totalEscrowed -= amount;

        uint256 providerProceeds = 0;
        uint256 fee = 0;
        if (pass) {
            fee = (amount * j.protocolFeeBps) / BPS_DENOMINATOR;
            providerProceeds = amount - fee;
            _credit(j.provider, providerProceeds);
            _credit(feeRecipient, fee);
            if (pBond > 0) {
                _releaseBond(pBond);
                _credit(j.provider, pBond); // honest provider's bond returned
            }
            j.state = State.Released;
        } else {
            _credit(j.buyer, amount); // refund buyer; no fee on refunds
            if (pBond > 0) {
                _releaseBond(pBond);
                _credit(j.buyer, pBond); // failed deliverable: provider bond compensates buyer
            }
            j.state = State.Refunded;
        }

        emit JobSettled(jobId, pass, providerProceeds, fee, j.reasonHash);
    }

    /// @dev ERC-8004 reputation + validation writes. Guarded: no-op until registries are set
    ///      (wired in build-order step 5). Failures here must not block settlement of funds,
    ///      so calls are best-effort.
    function _writeReputationAndValidation(Job storage j, bool pass) internal {
        uint256 agentId = j.providerAgentId;
        if (agentId == 0) return;
        if (address(validationRegistry) != address(0)) {
            try validationRegistry.recordValidation(agentId, pass, j.reasonHash) {} catch {}
        }
        if (address(reputationRegistry) != address(0)) {
            try reputationRegistry.giveFeedback(agentId, pass ? 100 : 0, j.reasonHash) {} catch {}
        }
    }

    /// @dev Settle the verifier's locked stake for a job: always unlock one pending verdict, and
    ///      if `slash` is set, move {slashPerVerdict} (capped at its stake) to `beneficiary`.
    function _resolveVerdictStake(uint256 jobId, Job storage j, bool slash, address beneficiary) internal {
        address[] storage signers = j.verdictSigners;
        uint256 n = signers.length;
        for (uint256 i = 0; i < n; i++) {
            address v = signers[i];
            if (pendingVerdicts[v] > 0) pendingVerdicts[v] -= 1;
            if (slash && slashPerVerdict > 0) {
                uint256 staked = verifierStake[v];
                uint256 amount = staked < slashPerVerdict ? staked : slashPerVerdict;
                if (amount > 0) {
                    verifierStake[v] = staked - amount;
                    totalVerifierStake -= amount;
                    _credit(beneficiary, amount);
                    emit VerifierSlashed(jobId, v, amount, beneficiary);
                }
            }
        }
    }

    /// @dev BondModule payout hook.
    function _payout(address to, uint256 amount) internal override {
        token.safeTransfer(to, amount);
    }

    function _expectState(Job storage j, State expected) private view {
        if (j.state != expected) revert InvalidState(expected, j.state);
    }

    function _authNonce(bytes32 kind, uint256 jobId, address account) private view returns (bytes32) {
        return keccak256(abi.encode(kind, block.chainid, address(this), jobId, account));
    }

    // ---------------------------------------------------------------------
    // Views (agents recompute these EIP-3009 nonces off-chain to sign authorizations)
    // ---------------------------------------------------------------------

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    function escrowNonce(uint256 jobId) external view returns (bytes32) {
        return _authNonce(FUND_ESCROW, jobId, _jobs[jobId].buyer);
    }

    function bondNonce(uint256 jobId) external view returns (bytes32) {
        return _authNonce(FUND_BOND, jobId, _jobs[jobId].provider);
    }

    function challengeNonce(uint256 jobId, address challenger) external view returns (bytes32) {
        return _authNonce(FUND_CHALLENGE, jobId, challenger);
    }

    /// @notice EIP-712 digest a verifier signs to post a verdict (exposed for the verifier service).
    function verdictDigest(
        uint256 jobId,
        bool pass,
        uint256 score,
        bytes32 reasonHash,
        string calldata evidenceURI,
        uint256 deadline
    ) external view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(VERDICT_TYPEHASH, jobId, pass, score, reasonHash, keccak256(bytes(evidenceURI)), deadline)
        );
        return _hashTypedDataV4(structHash);
    }

    // ---------------------------------------------------------------------
    // Admin (owner) — config + the verifier/resolver/registry seams
    // ---------------------------------------------------------------------

    /// @notice Configure the verifier set: minimum stake to be active, stake slashed per overturned
    ///         verdict, and the signature quorum required to record a verdict.
    function setVerifierParams(uint256 minStake, uint256 slashAmount, uint256 quorum) external onlyOwner {
        if (quorum == 0) revert InvalidQuorum();
        minVerifierStake = minStake;
        slashPerVerdict = slashAmount;
        verdictQuorum = quorum;
        emit VerifierParamsSet(minStake, slashAmount, quorum);
    }

    function setDisputeResolver(address resolver) external onlyOwner {
        if (resolver == address(0)) revert ZeroAddress();
        disputeResolver = resolver;
        emit DisputeResolverSet(resolver);
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    function setProtocolFee(uint16 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert FeeTooHigh();
        defaultProtocolFeeBps = bps;
        emit ProtocolFeeSet(bps);
    }

    function setChallengeBond(uint256 amount) external onlyOwner {
        challengeBondAmount = amount;
        emit ChallengeBondSet(amount);
    }

    function setVerdictTimeout(uint64 timeout) external onlyOwner {
        verdictTimeout = timeout;
        emit VerdictTimeoutSet(timeout);
    }

    function setRegistries(address reputation, address validation) external onlyOwner {
        reputationRegistry = IReputationRegistry(reputation);
        validationRegistry = IValidationRegistry(validation);
        emit RegistriesSet(reputation, validation);
    }
}
