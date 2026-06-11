import type { WalletClient } from "viem";
import { CHAIN_ID, USDC } from "./config.js";

export interface Authorization {
  from: `0x${string}`;
  to: `0x${string}`;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: `0x${string}`;
}

export interface VRS {
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
}

/**
 * Sign a USDC `ReceiveWithAuthorization` (EIP-3009) — this is the x402 "exact" payment payload.
 * USDC's EIP-712 domain is name "USD Coin", version "2". The contract redeems it via receive-
 * WithAuthorization (caller-bound), so funds can only land in the escrow.
 */
export async function signReceiveAuthorization(wallet: WalletClient, auth: Authorization): Promise<VRS> {
  const signature = await wallet.signTypedData({
    account: wallet.account!,
    domain: { name: "USD Coin", version: "2", chainId: CHAIN_ID, verifyingContract: USDC },
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
    message: auth,
  });

  return {
    r: `0x${signature.slice(2, 66)}`,
    s: `0x${signature.slice(66, 130)}`,
    v: parseInt(signature.slice(130, 132), 16),
  };
}
