import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseEventLogs,
  toBytes,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";
import { latchAbi, usdcAbi } from "./abi.js";
import { signReceiveAuthorization } from "./eip3009.js";

export interface LatchConfig {
  /** Fuji (or other) RPC URL for reads + sending txs. */
  rpcUrl: string;
  /** A private key (`0x…`) or a viem Account — the buyer or provider this client acts as. */
  account: Hex | Account;
  /** LatchJob escrow contract. */
  latch: Address;
  /** USDC (EIP-3009) token. */
  usdc: Address;
  /** Defaults to Avalanche Fuji. */
  chain?: Chain;
}

/** The signed x402/EIP-3009 payment payload (the `X-PAYMENT` body). */
export interface Payment {
  validAfter: string;
  validBefore: string;
  v: number;
  r: Hex;
  s: Hex;
}

/**
 * Plug-and-play Latch client. One instance acts as a single agent (buyer or provider); construct
 * two if your process plays both roles. No global config — everything is injected.
 *
 * ```ts
 * const latch = new Latch({ rpcUrl, account: BUYER_KEY, latch: LATCH, usdc: USDC });
 * const { jobId } = await latch.createJob({ provider, amount, bond, policyCommitment, challengeWindow });
 * const payment  = await latch.signPayment(jobId, amount);   // x402 payload
 * ```
 */
export class Latch {
  readonly account: Account;
  readonly latch: Address;
  readonly usdc: Address;
  readonly chain: Chain;
  private readonly pub: PublicClient;
  private readonly wallet: WalletClient;

  constructor(cfg: LatchConfig) {
    this.account = typeof cfg.account === "string" ? privateKeyToAccount(cfg.account) : cfg.account;
    this.latch = cfg.latch;
    this.usdc = cfg.usdc;
    this.chain = cfg.chain ?? avalancheFuji;
    this.pub = createPublicClient({ chain: this.chain, transport: http(cfg.rpcUrl) });
    this.wallet = createWalletClient({ account: this.account, chain: this.chain, transport: http(cfg.rpcUrl) });
  }

  get address(): Address {
    return this.account.address;
  }

  // ----------------------------- buyer -----------------------------

  /** Create a job on-chain. msg.sender (this account) is the buyer the refund is owed to. */
  async createJob(p: {
    provider: Address;
    amount: bigint;
    bond: bigint;
    policyCommitment: Hex;
    challengeWindow: number;
    providerAgentId?: bigint;
    submissionDeadline?: bigint;
  }): Promise<{ jobId: bigint; tx: Hex }> {
    const deadline = p.submissionDeadline ?? BigInt(Math.floor(Date.now() / 1000) + 86_400);
    const tx = await this.wallet.writeContract({
      account: this.account,
      chain: this.chain,
      address: this.latch,
      abi: latchAbi,
      functionName: "createJob",
      args: [p.provider, p.amount, p.bond, p.policyCommitment, p.providerAgentId ?? 0n, deadline, p.challengeWindow],
    });
    const receipt = await this.pub.waitForTransactionReceipt({ hash: tx });
    const logs = parseEventLogs({ abi: latchAbi, logs: receipt.logs, eventName: "JobCreated" });
    return { jobId: logs[0].args.jobId as bigint, tx };
  }

  /** Sign the EIP-3009 USDC payment that funds a job's escrow. Does not send a transaction. */
  async signPayment(jobId: bigint, amount: bigint): Promise<Payment> {
    const nonce = (await this.pub.readContract({
      address: this.latch,
      abi: latchAbi,
      functionName: "escrowNonce",
      args: [jobId],
    })) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const { v, r, s } = await signReceiveAuthorization(this.wallet, {
      usdc: this.usdc,
      chainId: this.chain.id,
      auth: { from: this.address, to: this.latch, value: amount, validAfter: 0n, validBefore, nonce },
    });
    return { validAfter: "0", validBefore: validBefore.toString(), v, r, s };
  }

  /** Redeem a signed payment into escrow (the facilitator role; anyone may submit it). */
  async fundJob(jobId: bigint, pay: Payment): Promise<Hex> {
    return this.send("fundJob", [jobId, BigInt(pay.validAfter), BigInt(pay.validBefore), pay.v, pay.r, pay.s]);
  }

  /** Settle the job after the challenge window. Pays the provider on PASS, refunds + slashes on FAIL. */
  finalize(jobId: bigint): Promise<Hex> {
    return this.send("finalize", [jobId]);
  }

  /** Withdraw whatever this account is owed (a buyer refund, or provider proceeds). */
  withdraw(): Promise<Hex> {
    return this.send("withdraw", []);
  }

  withdrawable(account: Address = this.address): Promise<bigint> {
    return this.pub.readContract({ address: this.latch, abi: latchAbi, functionName: "withdrawable", args: [account] }) as Promise<bigint>;
  }

  usdcBalance(account: Address = this.address): Promise<bigint> {
    return this.pub.readContract({ address: this.usdc, abi: usdcAbi, functionName: "balanceOf", args: [account] }) as Promise<bigint>;
  }

  // --------------------------- provider ----------------------------

  /** Accept a funded job by staking a bond (EIP-3009, approval-free). */
  async acceptJob(jobId: bigint, bond: bigint): Promise<Hex> {
    const nonce = (await this.pub.readContract({
      address: this.latch,
      abi: latchAbi,
      functionName: "bondNonce",
      args: [jobId],
    })) as Hex;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const { v, r, s } = await signReceiveAuthorization(this.wallet, {
      usdc: this.usdc,
      chainId: this.chain.id,
      auth: { from: this.address, to: this.latch, value: bond, validAfter: 0n, validBefore, nonce },
    });
    return this.send("acceptJob", [jobId, 0n, validBefore, v, r, s]);
  }

  /** Submit a deliverable: the payload stays off-chain, only its hash is recorded. */
  submitDeliverable(jobId: bigint, deliverable: unknown): Promise<Hex> {
    const hash = keccak256(toBytes(JSON.stringify(deliverable)));
    return this.send("submitDeliverable", [jobId, hash]);
  }

  // ----------------------------- internal --------------------------

  private async send(functionName: string, args: readonly unknown[]): Promise<Hex> {
    const tx = await this.wallet.writeContract({
      account: this.account,
      chain: this.chain,
      address: this.latch,
      abi: latchAbi,
      functionName: functionName as never,
      args: args as never,
    });
    await this.pub.waitForTransactionReceipt({ hash: tx });
    return tx;
  }
}

export { latchAbi, usdcAbi } from "./abi.js";
export { signReceiveAuthorization, type Authorization } from "./eip3009.js";
