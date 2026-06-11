import { latchAbi } from "./shared/abi.js";
import { LATCH, keys, publicClient, walletFor } from "./shared/config.js";
import type { PaymentPayload } from "./shared/x402.js";

/**
 * Latch's x402 facilitator. Verifies a payment payload and settles it into the escrow by
 * redeeming the EIP-3009 authorization through `fundJob` for the given jobId. fundJob is
 * permissionless (the buyer's signature is the authorization), so the facilitator just relays.
 */
export async function settle(jobId: bigint, payment: PaymentPayload): Promise<`0x${string}`> {
  const a = payment.payload.authorization;
  const sig = payment.payload.signature;
  const r = `0x${sig.slice(2, 66)}` as `0x${string}`;
  const s = `0x${sig.slice(66, 130)}` as `0x${string}`;
  const v = parseInt(sig.slice(130, 132), 16);

  const relayer = walletFor(keys.deployer);
  const hash = await relayer.writeContract({
    address: LATCH,
    abi: latchAbi,
    functionName: "fundJob",
    args: [jobId, BigInt(a.validAfter), BigInt(a.validBefore), v, r, s],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
