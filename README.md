# Latch

Latch is a verifiable settlement layer for agent commerce on Avalanche. When one
agent pays another for a deliverable, existing escrow tools release funds on shape
(valid JSON, no 5xx) — not substance. A provider that returns well-formed garbage
gets paid. Latch adds the missing piece: a verifier that produces a real,
evidence-backed verdict on whether a deliverable is actually correct, which an
ERC-8183-style escrow consumes to release or refund. Payment rails (x402),
identity and reputation (ERC-8004), and the job/escrow shape (ERC-8183) are the
commodity; the verifier and the optimistic settlement around it are the work.

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
3. **Agents** (`agents/`, TypeScript). Autonomous buyer and provider agents
   (including an adversarial provider for the demo) that discover via ERC-8004,
   fund via x402, and settle.
4. **Dashboard** (`web/`, React). A live agent-commerce explorer reading
   on-chain state and events: jobs, verdicts, evidence, reputation, the
   challenge window, and settlement.

## Trust model

v0 runs a single registered verifier key and a multisig dispute resolver. The
verdict and its evidence are public, and a challenge window plus dispute path
bound the trust. The designed trajectory replaces the single key with a staked
verifier set (an AVS with slashing) and the multisig with staked jurors; the
verifier and resolver are swappable addresses so this is a drop-in, not a
rewrite. Bonds are accounted in a module designed to be vaultized (ERC-4626)
later.

## What is real vs designed-for

Real and tested now:

- `LatchJob` full lifecycle, EIP-3009 funding, EIP-712 verdict intake,
  optimistic finalize, challenge/dispute, bond slashing, timeouts, pull-payment
  withdrawals.
- Unit, fuzz, and invariant test suites; Slither and Aderyn passes.

Designed-for, not yet built:

- The Rust verifier service and policy engine.
- x402 HTTP layer, ERC-8004 registry wiring, agents, dashboard.
- Staked verifier set / staked jurors, ERC-4626 bond vault, confidential
  settlement via Avalanche eERC.

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

Contracts and their test suites are complete and green. The verifier service is
next.

## License

MIT.
