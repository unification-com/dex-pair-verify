import { clientIp } from "../../../../../lib/clientIp";
import { verifyAndIssueToken } from "../../../../../lib/providerAuth";
import { isRegisteredProvider } from "../../../../../lib/providerRegistry";
import { rateLimit } from "../../../../../lib/rateLimit";

import type { NextApiRequest, NextApiResponse } from "next";

// Provider auth — step 2 (T8): a go-ooo instance POSTs { address, chainId, signature } (the EIP-191
// signature over the challenge from /auth/challenge). On a valid, unconsumed, unexpired challenge whose
// recovered signer matches address — and the wallet is still a registered provider — a short-lived
// bearer is issued. The raw token is returned ONCE; the DB stores only its sha256.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/; // 65-byte EIP-191 signature

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  const body = (req.body ?? {}) as { address?: unknown; chainId?: unknown; signature?: unknown };
  const address = typeof body.address === "string" ? body.address : "";
  const chainId = typeof body.chainId === "number" ? body.chainId : NaN;
  const signature = typeof body.signature === "string" ? body.signature : "";
  if (!EVM_ADDRESS.test(address) || !Number.isInteger(chainId) || !SIGNATURE.test(signature)) {
    return res.status(400).json({ error: "address, integer chainId and 65-byte signature required" });
  }

  const wall = Date.now();
  if (
    !rateLimit(`auth-verify:ip:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS, wall) ||
    !rateLimit(`auth-verify:addr:${address.toLowerCase()}`, RATE_LIMIT, RATE_WINDOW_MS, wall)
  ) {
    return res.status(429).json({ error: "rate limit exceeded" });
  }

  try {
    const issued = await verifyAndIssueToken(
      { address, chainId, signature, now: Math.floor(wall / 1000) },
      isRegisteredProvider,
    );
    if (!issued) {
      return res.status(401).json({ error: "challenge verification failed" });
    }
    return res.status(200).json(issued);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err) });
  }
}
