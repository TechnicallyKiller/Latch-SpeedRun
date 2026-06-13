import {
  createPublicClient,
  createWalletClient,
  custom,
  parseAbi,
  parseEventLogs,
  type Address,
  type WalletClient,
  type PublicClient,
} from "viem";
import { avalancheFuji } from "viem/chains";

const FUJI_HEX = "0xa869"; // 43113

const latchAbi = parseAbi([
  "function createJob(address provider, uint256 amount, uint256 providerBond, bytes32 policyCommitment, uint256 providerAgentId, uint64 submissionDeadline, uint32 challengeWindow) returns (uint256)",
  "function escrowNonce(uint256 jobId) view returns (bytes32)",
  "function withdrawable(address account) view returns (uint256)",
  "function withdraw() returns (uint256)",
  "event JobCreated(uint256 indexed jobId, address indexed buyer, address indexed provider, uint256 amount, uint256 providerBond, bytes32 policyCommitment)",
]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export interface Wallet {
  address: Address;
  wallet: WalletClient;
  pub: PublicClient;
}

function eth(): any {
  const e = (window as any).ethereum;
  if (!e) throw new Error("No wallet found. Install Core or MetaMask.");
  return e;
}

/** Connect an injected wallet and make sure it's on Fuji. */
export async function connect(): Promise<Wallet> {
  const provider = eth();
  const [address] = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
  await ensureFuji(provider);
  const wallet = createWalletClient({ account: address, chain: avalancheFuji, transport: custom(provider) });
  const pub = createPublicClient({ chain: avalancheFuji, transport: custom(provider) });
  return { address, wallet, pub };
}

async function ensureFuji(provider: any) {
  const current = (await provider.request({ method: "eth_chainId" })) as string;
  if (current.toLowerCase() === FUJI_HEX) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: FUJI_HEX }] });
  } catch (err: any) {
    if (err?.code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: FUJI_HEX,
            chainName: "Avalanche Fuji",
            nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
            rpcUrls: ["https://api.avax-test.network/ext/bc/C/rpc"],
            blockExplorerUrls: ["https://testnet.snowtrace.io"],
          },
        ],
      });
    } else throw err;
  }
}

export async function balances(w: Wallet, usdc: Address): Promise<{ avax: bigint; usdc: bigint }> {
  const [avax, bal] = await Promise.all([
    w.pub.getBalance({ address: w.address }),
    w.pub.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [w.address] }) as Promise<bigint>,
  ]);
  return { avax, usdc: bal };
}

/** The judge creates the job on-chain, msg.sender (them) becomes the buyer the refund is owed to. */
export async function createJob(
  w: Wallet,
  latch: Address,
  args: { provider: Address; amount: bigint; bond: bigint; commitment: `0x${string}`; window: number },
): Promise<{ jobId: bigint; tx: `0x${string}` }> {
  const tx = await w.wallet.writeContract({
    account: w.address,
    chain: avalancheFuji,
    address: latch,
    abi: latchAbi,
    functionName: "createJob",
    args: [args.provider, args.amount, args.bond, args.commitment, 0n, BigInt(Math.floor(Date.now() / 1000) + 86_400), args.window],
  });
  const receipt = await w.pub.waitForTransactionReceipt({ hash: tx });
  const logs = parseEventLogs({ abi: latchAbi, logs: receipt.logs, eventName: "JobCreated" });
  return { jobId: logs[0].args.jobId as bigint, tx };
}

export interface SignedPayment {
  validAfter: string;
  validBefore: string;
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
}

/** The judge signs the USDC ReceiveWithAuthorization, the real payment, from their own balance. */
export async function signPayment(
  w: Wallet,
  args: { usdc: Address; latch: Address; jobId: bigint; amount: bigint },
): Promise<SignedPayment> {
  const nonce = (await w.pub.readContract({
    address: args.latch,
    abi: latchAbi,
    functionName: "escrowNonce",
    args: [args.jobId],
  })) as `0x${string}`;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const signature = await w.wallet.signTypedData({
    account: w.address,
    domain: { name: "USD Coin", version: "2", chainId: 43113, verifyingContract: args.usdc },
    types: {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "ReceiveWithAuthorization",
    message: { from: w.address, to: args.latch, value: args.amount, validAfter: 0n, validBefore, nonce },
  });
  return {
    validAfter: "0",
    validBefore: validBefore.toString(),
    r: `0x${signature.slice(2, 66)}`,
    s: `0x${signature.slice(66, 130)}`,
    v: parseInt(signature.slice(130, 132), 16),
  };
}

export async function withdrawableOf(w: Wallet, latch: Address): Promise<bigint> {
  return w.pub.readContract({ address: latch, abi: latchAbi, functionName: "withdrawable", args: [w.address] }) as Promise<bigint>;
}

/** Judge pulls their refund, the USDC lands back in their wallet. The payoff moment. */
export async function withdraw(w: Wallet, latch: Address): Promise<`0x${string}`> {
  const tx = await w.wallet.writeContract({ account: w.address, chain: avalancheFuji, address: latch, abi: latchAbi, functionName: "withdraw", args: [] });
  await w.pub.waitForTransactionReceipt({ hash: tx });
  return tx;
}
