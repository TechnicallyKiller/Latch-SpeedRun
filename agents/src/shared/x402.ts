import type { Authorization } from "./eip3009.js";

/**
 * Minimal, faithful x402 implementation for the "exact" (EIP-3009) scheme on Avalanche.
 * Latch is its own facilitator: the payTo target is the LatchJob escrow and `extra.jobId`
 * binds the payment to a specific job, which the facilitator settles via `fundJob`.
 */

export const X402_VERSION = 1;
export const NETWORK = "avalanche-fuji";

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  maxAmountRequired: string; // atomic units, as a string
  resource: string;
  description: string;
  mimeType: string;
  payTo: `0x${string}`;
  maxTimeoutSeconds: number;
  asset: `0x${string}`;
  extra: { name: string; version: string; jobId: string };
}

/** The 402 response body. */
export interface PaymentRequiredBody {
  x402Version: number;
  error: string;
  accepts: PaymentRequirements[];
}

/** The decoded X-PAYMENT header (exact scheme). */
export interface PaymentPayload {
  x402Version: number;
  scheme: "exact";
  network: string;
  payload: {
    signature: `0x${string}`;
    authorization: {
      from: `0x${string}`;
      to: `0x${string}`;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: `0x${string}`;
    };
  };
}

export function encodePayment(p: PaymentPayload): string {
  return Buffer.from(JSON.stringify(p)).toString("base64");
}

export function decodePayment(header: string): PaymentPayload {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
}

export function buildPayment(
  signature: `0x${string}`,
  auth: Authorization,
): PaymentPayload {
  return {
    x402Version: X402_VERSION,
    scheme: "exact",
    network: NETWORK,
    payload: {
      signature,
      authorization: {
        from: auth.from,
        to: auth.to,
        value: auth.value.toString(),
        validAfter: auth.validAfter.toString(),
        validBefore: auth.validBefore.toString(),
        nonce: auth.nonce,
      },
    },
  };
}
