import { type Job, usdc } from "./chain";

export type Actor = "buyer" | "provider" | "verifier" | "facilitator" | "contract";
export type StepStatus = "done" | "idle" | "pass" | "fail" | "context";

export interface CodeRef {
  lang: "sol" | "rust" | "ts";
  ref: string;
  note: string;
}

export interface Step {
  key: string;
  title: string;
  actor: Actor;
  status: StepStatus;
  tx?: `0x${string}`;
  summary: string;
  detail: string;
  code: CodeRef[];
  data?: [string, string][];
}

/** Build the workflow nodes for a job from its real on-chain events. */
export function buildSteps(job: Job): Step[] {
  const v = job.verdict;
  const passed = job.settled?.pass ?? v?.pass;
  const outcomeStatus: StepStatus = passed === undefined ? "idle" : passed ? "pass" : "fail";

  const steps: Step[] = [
    {
      key: "create",
      title: "Create job",
      actor: "buyer",
      status: job.created ? "done" : "idle",
      tx: job.created?.tx,
      summary: "Buyer posts the job and commits the secret answer-key hash.",
      detail:
        "The buyer creates the job on-chain and commits a hash of the verification policy (including the held-out answer key). Because it is committed up front, the provider can never see the test, and the buyer can never change it after seeing the work.",
      code: [{ lang: "sol", ref: "LatchJob.createJob()", note: "stores terms + the policy commitment" }],
      data: [
        ["amount", usdc(job.amount)],
        ["provider bond", usdc(job.bond)],
        ["policy", "ground-truth sample"],
      ],
    },
    {
      key: "fund",
      title: "Fund · x402",
      actor: "facilitator",
      status: job.funded ? "done" : "idle",
      tx: job.funded?.tx,
      summary: "Buyer pays over HTTP 402; the payment is settled into escrow.",
      detail:
        "The provider gateway returns HTTP 402 Payment Required. The buyer signs an EIP-3009 USDC authorization (the X-PAYMENT header) bound to this job's nonce. Latch's own facilitator redeems it into the escrow — receiveWithAuthorization is caller-bound, so the funds can only land in the escrow, and the job-bound nonce stops any replay.",
      code: [
        { lang: "ts", ref: "agents/facilitator.ts → settle()", note: "verifies + relays the x402 payment" },
        { lang: "sol", ref: "LatchJob.fundJob()", note: "redeems the EIP-3009 authorization" },
        { lang: "sol", ref: "USDC.receiveWithAuthorization (EIP-3009)", note: "caller-bound stablecoin pull" },
      ],
      data: [["amount", usdc(job.amount)]],
    },
    {
      key: "accept",
      title: "Accept · bond",
      actor: "provider",
      status: job.accepted ? "done" : "idle",
      tx: job.accepted?.tx,
      summary: "Provider posts a bond and takes the job.",
      detail:
        "The provider stakes a bond (also via EIP-3009, approval-free) to take the job. The bond is skin in the game: if the provider delivers garbage, it is slashed to the buyer.",
      code: [{ lang: "sol", ref: "LatchJob.acceptJob()", note: "locks the provider bond" }],
      data: [["provider bond", usdc(job.bond)]],
    },
    {
      key: "submit",
      title: "Submit work",
      actor: "provider",
      status: job.submitted ? "done" : "idle",
      tx: job.submitted?.tx,
      summary: "Provider does the work and submits a fingerprint of the deliverable.",
      detail:
        "The provider produces its deliverable and submits a hash of it on-chain; the payload itself stays off-chain. An honest provider returns correct answers; an adversarial one returns well-formed-but-wrong answers — which shape-only escrow would happily pay for.",
      code: [
        { lang: "ts", ref: "agents/provider.ts → /hire", note: "does the work, submits the hash" },
        { lang: "sol", ref: "LatchJob.submitDeliverable()", note: "records the submission hash" },
      ],
    },
    {
      key: "verify",
      title: "Verify (off-chain)",
      actor: "verifier",
      status: v ? outcomeStatus : "idle",
      summary: "A staked verifier scores the deliverable against the secret answer key.",
      detail:
        "This is the core IP, off-chain in Rust. The verifier reveals the committed sample, scores the provider's actual answers against the known labels, computes a pass/fail + score, assembles public evidence, and signs an EIP-712 verdict. The check is deterministic, so every honest verifier produces an identical verdict — a disagreement is itself provable evidence of fault.",
      code: [
        { lang: "rust", ref: "policy::GroundTruthPolicy::evaluate()", note: "scores answers vs the answer key" },
        { lang: "rust", ref: "run_verification()", note: "enforces the commit-reveal, then signs" },
        { lang: "rust", ref: "verdict (EIP-712)", note: "signs the verdict for the contract" },
      ],
      data: v ? [["score", `${v.score} / 100`], ["verdict", v.pass ? "PASS" : "FAIL"]] : undefined,
    },
    {
      key: "verdict",
      title: "Submit verdict",
      actor: "verifier",
      status: v ? outcomeStatus : "idle",
      tx: v?.tx,
      summary: "The signed verdict is posted on-chain — a k-of-n staked quorum.",
      detail:
        "The contract recovers each signature, requires a quorum of distinct active (staked) verifiers, records the verdict and its evidence, and opens a short challenge window. An overturned verdict later slashes every signer.",
      code: [
        { lang: "rust", ref: "chain::submit_verdict()", note: "sends the signed verdict on-chain" },
        { lang: "sol", ref: "LatchJob.submitVerdict()", note: "quorum check + opens the window" },
      ],
      data: v ? [["score", `${v.score} / 100`], ["signers", v.signers.toString()], ["evidence", v.evidenceURI]] : undefined,
    },
    {
      key: "finalize",
      title: "Finalize",
      actor: "contract",
      status: job.settled ? "done" : "idle",
      tx: job.settled?.tx,
      summary: "After the challenge window elapses, the escrow settles.",
      detail:
        "Once the window passes with no challenge, anyone can finalize. The contract settles the escrow according to the verdict — release on pass, refund + slash on fail — in seconds, thanks to Avalanche's fast finality.",
      code: [{ lang: "sol", ref: "LatchJob.finalize() → _settle()", note: "optimistic settlement" }],
    },
    {
      key: "outcome",
      title: passed === false ? "Refund + slash" : "Release",
      actor: "contract",
      status: outcomeStatus,
      tx: job.settled?.tx,
      summary:
        passed === false
          ? "Buyer refunded the full amount + the provider's slashed bond. Scammer paid nothing."
          : passed
            ? "Provider paid the amount minus the protocol fee; its bond is returned."
            : "Awaiting settlement.",
      detail:
        passed === false
          ? "On a FAIL, the escrow refunds the buyer the full amount and slashes the provider's bond to the buyer as compensation. The provider that returned well-formed garbage gets nothing — the exact case every shape-only escrow pays out on."
          : "On a PASS, the provider receives the amount minus a small protocol fee, and its bond is returned. The buyer got verifiably correct work.",
      code: [{ lang: "sol", ref: passed === false ? "_settle(false)" : "_settle(true)", note: "credits the pull-payment ledger" }],
      data: job.settled
        ? job.settled.pass
          ? [["proceeds", usdc(job.settled.proceeds)], ["fee", usdc(job.settled.fee)]]
          : [["refunded", usdc(job.amount + job.bond)]]
        : undefined,
    },
    {
      key: "reputation",
      title: "Reputation (ERC-8004)",
      actor: "buyer",
      status: "context",
      summary: "The buyer records feedback about the provider in the ERC-8004 registry.",
      detail:
        "After settlement the buyer writes feedback to the canonical ERC-8004 Reputation registry, referencing the verdict evidence. Honest providers' reputation climbs; a caught scammer's drops to zero — and the buyer reads that reputation to choose who to hire next time.",
      code: [{ lang: "ts", ref: "agents/erc8004.ts → giveFeedback()", note: "writes on-chain reputation" }],
    },
  ];

  return steps;
}
