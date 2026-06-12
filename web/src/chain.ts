// Two real jobs from the live committee contract on Fuji (0xa5cA9c…). Hardcoded tx hashes so the
// explorer loads instantly and still links to real on-chain proof — no chain scanning needed.

export const LATCH = "0xa5cA9c7920F22E1104215C430227756dEBBb2a09";

export const snowtraceTx = (h: string) => `https://testnet.snowtrace.io/tx/${h}`;
export const snowtraceAddr = (a: string) => `https://testnet.snowtrace.io/address/${a}`;
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const usdc = (v: bigint) => `${(Number(v) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC`;

interface Stamp {
  tx: `0x${string}`;
}
export interface Job {
  id: bigint;
  label: string;
  amount: bigint;
  bond: bigint;
  created?: Stamp;
  funded?: Stamp;
  accepted?: Stamp;
  submitted?: Stamp;
  verdict?: Stamp & { pass: boolean; score: bigint; evidenceURI: string; signers: bigint };
  settled?: Stamp & { pass: boolean; proceeds: bigint; fee: bigint };
}

const PASS: Job = {
  id: 1n,
  label: "Honest provider · paid",
  amount: 5000n,
  bond: 1000n,
  created: { tx: "0xd6fbfd5e91b4eb26478f5aa77bd9941d12037246f5967c963700dc176f097ba5" },
  funded: { tx: "0xe867cb7082ddc01dfda3bff0332acc4cd153ff690b61c75d4865140ac732e816" },
  accepted: { tx: "0xbb0713bc46608e34154e61f3a25f4442b76cc630fd4d605afef7675fa3799a06" },
  submitted: { tx: "0xd128c57f4a48e31affe4963775114c0bfbe70b9e96dab8509b21e86c621e3e4f" },
  verdict: {
    tx: "0xa0f7a98fc4bdc9ba4d53b24277f54bc0921ecdfc331695bca293ce28ceea04aa",
    pass: true,
    score: 100n,
    evidenceURI: "ipfs://QmbnCXEgWKeqHiv9S1o6GN2Twk2Cu9rK3FeiPkfgjZLMNd",
    signers: 1n,
  },
  settled: { tx: "0xad493897c4da07b3a42ef931f184ab321aa8e2687b99c40b653ab5ff21dcf880", pass: true, proceeds: 4950n, fee: 50n },
};

const FAIL: Job = {
  id: 2n,
  label: "Scammer · caught & refunded-against",
  amount: 5000n,
  bond: 1000n,
  created: { tx: "0x2784253921e7af809b4788b558051f093eee04eccaf91dee2801cea6cff0acc7" },
  funded: { tx: "0xcad0c0642d6fe5f751cd589ecda668c7dfef1f1fd31443f72e43f400ecbe3ba6" },
  accepted: { tx: "0xa8d6b270069dd1fb3765d8eb48dc9defd7a1c79bd9dd601fba046484c5b41061" },
  submitted: { tx: "0xe984df3af6a35617cfbbcd997337dcd00258ecc53fc235ffa61baa6e41873a1e" },
  verdict: {
    tx: "0xd4c6dffee112dffc0c90405602d1697707e0e10feb252c5f4afca204a9a715b2",
    pass: false,
    score: 0n,
    evidenceURI: "ipfs://QmYVMHj6f7ktxjKMNUeXWWzFi93hHzccY9nUbdgMGBx4nb",
    signers: 1n,
  },
  settled: { tx: "0x2f45fba8ec5a6a697edf5e76fc74bf4d91132edf606d00fb7f7ec5a153d77622", pass: false, proceeds: 0n, fee: 0n },
};

export const JOBS: Job[] = [PASS, FAIL];
