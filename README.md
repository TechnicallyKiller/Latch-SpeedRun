# Latch

Latch is a verifiable settlement layer for agent commerce on Avalanche. When one
agent pays another for a deliverable, existing escrow tools release funds on shape
(valid JSON, no 5xx) — not substance. A provider that returns well-formed garbage
gets paid. Latch adds the missing piece: a verifier that produces a real,
evidence-backed verdict on whether a deliverable is actually correct, which an
ERC-8183-style escrow consumes to release or refund. Payment rails (x402),
identity and reputation (ERC-8004), and the job/escrow shape (ERC-8183) are the
commodity; the verifier and the optimistic settlement around it are the work.

## Try it live

**Live site:** https://REPLACE-WITH-YOUR-SITE.netlify.app

It's not a mockup — every action is a real transaction on Avalanche Fuji:

- **Live Demo** (`/explorer`) — press one button and watch a real job settle on-chain, node by
  node, with Snowtrace links. The provider is a **real LLM agent** (Llama 3.3 via Groq): the honest
  one reads the task and is correct; the "scammer" is denied the answer key and returns confident,
  well-formed garbage — and gets caught.
- **Post a job** (`/post`) — **connect your wallet, pay real testnet USDC**, send the work to a
  scammer, and watch the verifier slash its bond and **refund the money to your own wallet**. You are
  the buyer; nothing is faked.
- **Docs · SDK · Security · Business** pages explain the mechanism, how to integrate an agent, the
  threat model, and how it monetizes.

Contract (LatchJob) on Fuji: `0xa5cA9c7920F22E1104215C430227756dEBBb2a09`.

## Why it is different

- x402 answers *can agents pay each other*.
- ERC-8004 answers *who to trust*.
- ERC-8183 answers *how to structure the job and escrow*.
- None answer *was the deliverable correct* at settlement. Latch does.

The escrow releases only against a signed verdict. A short challenge window —
justified by Avalanche's ~1s finality — backs the optimistic path, and a dispute
resolver plus bonds make lying expensive.

## Architecture

Four layers:

1. **Contracts** (`contracts/`, Solidity + Foundry). `LatchJob`, an
   ERC-8183-compatible escrow: funded with USDC via self-redeemed EIP-3009
   (Latch is its own x402 settlement target — no trusted facilitator), verdict
   intake gated by a registered verifier's EIP-712 signature, optimistic
   `finalize`, challenge/dispute with bond slashing, and timeouts so funds can
   never be stuck.
2. **Verifier** (`verifier/`, Rust). The core IP. Given a deliverable and the
   job's verification policy, it computes a deterministic correctness verdict,
   assembles public evidence, signs it, and submits it on-chain. Policies:
   JSON_SCHEMA, GROUND_TRUTH_SAMPLE (commit-reveal, the anti-garbage core),
   STATISTICAL_BOUNDS, DETERMINISTIC_HASH, TEST_SUITE.
3. **Agents** (`agents/`, TypeScript). Autonomous buyer and provider agents that discover via
   ERC-8004, fund via x402, and settle. The providers are **real LLM agents** (Groq Llama 3.3 or
   Claude, with a deterministic fallback): an honest agent that does the work, and an adversarial
   one that returns confident, well-formed-but-wrong output. A small SSE server (`server.ts`) runs
   one real job on demand and streams each step to the dashboard.
4. **Dashboard** (`web/`, React). A live agent-commerce explorer reading
   on-chain state and events: jobs, verdicts, evidence, reputation, the
   challenge window, and settlement. Includes a dedicated **business model**
   page explaining how the protocol and the verifier network earn.

## Trust model

Verifiers must stake the escrow token to be active. A verdict is not recorded
until a quorum (k-of-n) of distinct staked verifiers co-sign it; their stake
locks while the verdict is unsettled, and an overturned dispute slashes every
signer to the wronged party. Because verification is deterministic, honest
verifiers produce byte-identical verdicts and co-sign one payload — and a
disagreement is itself evidence of fault, reproducible from the public evidence.
The dispute resolver is a multisig in v0 (designed to become staked jurors).
Bonds are accounted in a module designed to be vaultized (ERC-4626) later. This
turns "who checks the checker?" from "trust us" into "a staked set that is
financially punished for lying, and cannot unstake to escape it."

## Business model

Latch is the trust-and-settlement rail for the agent economy: we take a small
cut of every transaction we make safe, and we run the staked network that
decides what "safe" means. Money is in throughput, not margin — the take-rate
stays low because agent payments are small and price-sensitive, so the value is
in the total volume of agent commerce settled through Latch.

Three revenue lines, nearest-to-furthest cash:

1. **Hosted verification (SaaS) — nearest revenue.** The verifier is the IP. Sell
   it directly: "you run agents, we run the referee." Per-verification pricing or
   a subscription, plus custom policy authoring for enterprises (verify a
   dataset's quality, a model's output, a code deliverable). Earns money before a
   large agent economy exists, because teams running agent fleets need it today.
2. **Protocol take-rate on settled volume — the scale play.** A protocol fee on
   every successful release (the on-chain fee primitive already exists). Small
   per-job, compounding as autonomous agent commerce grows. Comparables: Stripe
   (~2.9%/tx, payment only), Upwork/Escrow.com (5–20%, human escrow + dispute) —
   Latch automates the "was the work correct?" judgment for agents, with no human.
3. **The staked verifier network — long-term value capture.** Oracle-network
   economics (think Chainlink, or an EigenLayer-style AVS). The network is the
   business: it produces trust and charges for it, with a reinforcing loop —
   more verifiers, more trust, more buyers, more fees, more verifiers — and
   reputation data (ERC-8004) accruing to the network makes agents sticky.

How the verifiers earn (the network's incentive design): a portion of each
settled job's protocol fee is paid to the quorum that signed the verdict, split
by participation. A verifier's economics are **verification fees + yield on
stake − operating cost − slashing risk**. Honest, competent operators profit;
lazy or dishonest ones are slashed and exit. (Implementation status: the on-chain
fee primitive and the staking/slashing are built; the fee-to-verifier split is
the designed incentive, not yet coded — today the fee accrues to the protocol.)

Who pays, and why it is rational:

- **Buyers** pay because the fee is cheap insurance against paying full price for
  garbage — trivially worth it versus the downside.
- **Honest providers** want it because verifiable correctness lets them beat
  cheaper scammers; it creates a market that rewards quality.

Honest risks: agent-to-agent commerce at scale is forming, not formed (x402 /
ERC-8004 / ERC-8183 are early), so the take-rate play is a bet on that market
emerging — the SaaS line funds the company while it matures. A token is optional
and not assumed; the fee + SaaS model stands without one.

Phasing: (1) ecosystem grants fund the build and prove the loop on-chain;
(2) hosted verification SaaS for early cash and IP validation; (3) protocol
take-rate as agent volume grows; (4) open the staked verifier network as the
trust rail for the broader agent economy.

## What is real vs designed-for

Real and tested now:

- `LatchJob` full lifecycle, EIP-3009 funding, EIP-712 verdict intake,
  optimistic finalize, challenge/dispute, bond slashing, timeouts, pull-payment
  withdrawals. Unit, fuzz, and invariant test suites; Slither and Aderyn passes.
- The verifier policy engine (JSON_SCHEMA, GROUND_TRUTH_SAMPLE with enforced
  commit-reveal), EIP-712 verdict signing, the content-addressed evidence store,
  and the on-chain submission code. A cross-language golden-vector test proves the
  Rust verifier and the Solidity contract compute identical EIP-712 digests.
- The full verify-then-settle loop, live on a local anvil fork: deploy, fund via
  a Rust-signed EIP-3009 authorization, accept, submit, the Rust verifier signs
  and submits the verdict on-chain, finalize, and withdraw. Both outcomes are
  asserted end-to-end — an honest deliverable pays the provider, and well-formed
  garbage refunds the buyer and slashes the provider's bond.

- The same loop **live on Fuji** end-to-end: the real x402 HTTP layer (Latch is its own
  facilitator), ERC-8004 registry wiring, the autonomous agents, real LLM providers, IPFS-pinned
  evidence, and the dashboard. Deployed and runnable from the live site by anyone.
- The **staked verifier committee** (k-of-n quorum, stake, slash on overturn).

Designed-for, not yet built:

- A larger decentralized verifier set / staked jurors, ERC-4626 bond vault, the fee-to-verifier
  split, richer correctness policies for subjective tasks, confidential settlement via Avalanche
  eERC, and a third-party audit before mainnet value.

## Repository

```
contracts/   Foundry project: src, test (unit + fuzz + invariant), script
verifier/    Rust verifier service (core IP)
agents/      TypeScript buyer + provider agents
web/         React dashboard
packages/    Shared ABIs, types, addresses (populated only after verified deploy)
docs/        Architecture, threat model, demo script, deployment runbook
```

## Build and test

Foundry is required (the toolchain runs on Linux/WSL).

```
cd contracts
forge build
forge test            # unit + fuzz + invariant
forge snapshot        # gas
slither .             # static analysis
aderyn .              # static analysis
```

Rust (1.85+) is required for the verifier.

```
cd verifier
cargo test                          # policy engine, signing, cross-language digest vector
cargo test --test e2e_anvil -- --ignored   # live full loop (needs anvil on PATH)
```

The `e2e_anvil` test spawns a local anvil node, deploys the contracts, and runs
the entire verify-then-settle loop for both the pass and fail outcomes.

## Live on Fuji

The staked-committee `LatchJob` is deployed on Avalanche Fuji at
[`0xa5cA9c7920F22E1104215C430227756dEBBb2a09`](https://testnet.snowtrace.io/address/0xa5cA9c7920F22E1104215C430227756dEBBb2a09),
running against the real USDC, with the verifier staked on-chain. The demo runner
drives the full loop on Fuji with real USDC and IPFS-pinned evidence, printing a
Snowtrace link per transaction (including the verifier's stake):

```
# .env at the repo root holds the RPC, keys, deployed address, and Pinata token
forge script contracts/script/DeployFuji.s.sol --rpc-url <fuji> --broadcast   # deploy
cargo run --bin fuji_demo -- pass    # honest deliverable -> provider paid
cargo run --bin fuji_demo -- fail    # well-formed garbage -> buyer refunded, bond slashed
```

## Confirmed on-chain facts

Verified against official sources; addresses are not assumed.

- Avalanche Fuji testnet: chain id 43113, RPC `https://api.avax-test.network/ext/bc/C/rpc`.
- Avalanche C-Chain mainnet: chain id 43114, RPC `https://api.avax.network/ext/bc/C/rpc`.
- USDC (FiatTokenV2, EIP-3009): Fuji `0x5425890298aed601595a70AB815c96711a31Bc65`,
  mainnet `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E`.
- ERC-8004 on Fuji: Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e`,
  Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713`. The Validation
  Registry has no canonical deployment; Latch deploys the reference
  implementation itself.
- ERC-8183 is a draft; Latch implements a compatible job/escrow, not a
  dependency on a canonical deployment.

## Status

The contracts, the verifier, and the full verify-then-settle loop are complete and
green, proven end-to-end on a local anvil fork and live on Avalanche Fuji for both
the pass and fail outcomes (real USDC, IPFS-pinned evidence). The **staked verifier
committee** (stake to verify, k-of-n quorum, slash every signer on an overturned
verdict) is built and tested — 55 Solidity tests, the cross-language digest vector,
and the anvil e2e all pass — and is being readied for a live Fuji deployment.

Next: the x402 HTTP layer, the ERC-8004 registry wiring, the autonomous agents, and
the dashboard (including the dedicated business-model page).

## License

MIT.
