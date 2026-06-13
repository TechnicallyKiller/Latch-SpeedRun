# @latch/sdk

Plug-and-play client for **Latch** — verifiable settlement for agent commerce on Avalanche. Let one
agent pay another and release funds **only when the work is verifiably correct**, with a staked
verifier set and slashing. This SDK is config-injected (no global env), so any agent — buyer or
provider — can integrate in a few calls.

```bash
npm install @latch/sdk viem
```

## Quickstart

```ts
import { Latch } from "@latch/sdk";

const FUJI = "https://api.avax-test.network/ext/bc/C/rpc";
const LATCH = "0xa5cA9c7920F22E1104215C430227756dEBBb2a09";
const USDC  = "0x5425890298aed601595a70AB815c96711a31Bc65";
```

### Buyer — hire and pay for verified work

```ts
const buyer = new Latch({ rpcUrl: FUJI, account: BUYER_KEY, latch: LATCH, usdc: USDC });

// 1. create the job, committing the correctness policy hash up front
const { jobId } = await buyer.createJob({
  provider, amount: 5000n, bond: 1000n, policyCommitment, challengeWindow: 60,
});

// 2. sign the x402 / EIP-3009 USDC payment (no tx yet — this is the X-PAYMENT body)
const payment = await buyer.signPayment(jobId, 5000n);

// ...the provider does the work and a staked verifier scores it...

// 3. after the challenge window: pays the provider on PASS, refunds you + slashes on FAIL
await buyer.finalize(jobId);
await buyer.withdraw();          // pull any refund back to your wallet
```

### Provider — sell work, bonded

```ts
const provider = new Latch({ rpcUrl: FUJI, account: PROVIDER_KEY, latch: LATCH, usdc: USDC });

await provider.acceptJob(jobId, 1000n);            // stake a bond (EIP-3009, approval-free)
const deliverable = await myAgent.run(task);       // your real agent logic
await provider.submitDeliverable(jobId, deliverable);
```

The bond is skin in the game: return well-formed garbage and the verifier scores it FAIL, refunding
the buyer and **slashing your bond**. Do the work correctly and you're paid the amount minus a small
protocol fee.

## API

| Method | Role | What it does |
|---|---|---|
| `createJob(p)` | buyer | create the job + commit the policy hash; returns `{ jobId, tx }` |
| `signPayment(jobId, amount)` | buyer | sign the EIP-3009 payment (the x402 `X-PAYMENT` body) |
| `fundJob(jobId, payment)` | facilitator | redeem a signed payment into escrow |
| `acceptJob(jobId, bond)` | provider | stake a bond and take the job |
| `submitDeliverable(jobId, data)` | provider | record the deliverable hash on-chain |
| `finalize(jobId)` | anyone | settle after the challenge window |
| `withdraw()` | buyer / provider | pull funds owed (refund or proceeds) |
| `withdrawable(addr?)` / `usdcBalance(addr?)` | — | reads |

Funding is caller-bound and job-nonce-bound, so a payment can only land in the right escrow and can't
be replayed. Verdicts are produced by a staked verifier committee (k-of-n quorum, slashed if
overturned) — see the main project docs and the `/security` threat model.

## Status

v0 on Avalanche Fuji. Built for the Avalanche agentic-payments work; mainnet awaits a third-party
audit. The verifier policy types and the staked committee live in the main repo.
