import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { createPublicClient, createWalletClient, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";

// Load the repo-root .env regardless of where the process is started from.
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });

function req(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env var ${key}`);
  return v;
}

export const RPC = req("FUJI_RPC_URL");
export const CHAIN_ID = Number(process.env.CHAIN_ID ?? 43113);
export const LATCH = getAddress(req("LATCHJOB_ADDRESS"));
export const USDC = getAddress(req("USDC_ADDRESS"));

export const keys = {
  deployer: req("DEPLOYER_PRIVATE_KEY") as `0x${string}`,
  buyer: req("BUYER_PRIVATE_KEY") as `0x${string}`,
  provider: req("PROVIDER_PRIVATE_KEY") as `0x${string}`,
  verifier: req("VERIFIER_PRIVATE_KEY") as `0x${string}`,
};

export const amounts = {
  job: BigInt(process.env.JOB_AMOUNT ?? "5000"),
  bond: BigInt(process.env.PROVIDER_BOND ?? "1000"),
  window: Number(process.env.CHALLENGE_WINDOW ?? "60"),
};

export const publicClient = createPublicClient({ chain: avalancheFuji, transport: http(RPC) });

export function walletFor(pk: `0x${string}`) {
  return createWalletClient({ account: privateKeyToAccount(pk), chain: avalancheFuji, transport: http(RPC) });
}

export const addrOf = (pk: `0x${string}`) => privateKeyToAccount(pk).address;

export const snowtrace = (hash: string) => `https://testnet.snowtrace.io/tx/${hash}`;
