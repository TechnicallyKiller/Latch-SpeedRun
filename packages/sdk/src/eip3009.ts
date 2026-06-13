import type { Address, Hex, WalletClient } from "viem";

export interface Authorization {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}

/**
 * Sign a USDC `ReceiveWithAuthorization` (EIP-3009) — the x402 "exact" payment payload. The token's
 * EIP-712 domain is name "USD Coin" version "2"; redemption is caller-bound, so funds can only land
 * in the escrow.
 */
export async function signReceiveAuthorization(
  wallet: WalletClient,
  p: { usdc: Address; chainId: number; auth: Authorization },
): Promise<{ v: number; r: Hex; s: Hex }> {
  const signature = await wallet.signTypedData({
    account: wallet.account!,
    domain: { name: "USD Coin", version: "2", chainId: p.chainId, verifyingContract: p.usdc },
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
    message: p.auth,
  });
  return {
    r: `0x${signature.slice(2, 66)}`,
    s: `0x${signature.slice(66, 130)}`,
    v: parseInt(signature.slice(130, 132), 16),
  };
}
