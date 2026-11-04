import { clientIp } from "../../../../../lib/clientIp";
import { createChallenge } from "../../../../../lib/providerAuth";
import { isRegisteredProvider } from "../../../../../lib/providerRegistry";
import { rateLimit } from "../../../../../lib/rateLimit";

import type { NextApiRequest, NextApiResponse } from "next";

// Provider auth — step 1 (T8): a go-ooo instance POSTs { address, chainId }; if that wallet is a
// registered provider on that chain's OoO Router, it gets a single-use EIP-191 challenge to sign. No
// secret crosses the wire. The signed challenge is exchanged for a bearer at /auth/verify.
const RATE_LIMIT = 20; // challenges per window, per IP and per address
const RATE_WINDOW_MS = 60_000;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  const body = (req.body ?? {}) as { address?: unknown; chainId?: unknown };
  const address = typeof body.address === "string" ? body.address : "";
  const chainId = typeof body.chainId === "number" ? body.chainId : NaN;
  if (!EVM_ADDRESS.test(address) || !Number.isInteger(chainId)) {
    return res.status(400).json({ error: "address (0x40 hex) and integer chainId required" });
  }

  const wall = Date.now();
  if (
    !rateLimit(`auth-challenge:ip:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS, wall) ||
    !rateLimit(`auth-challenge:addr:${address.toLowerCase()}`, RATE_LIMIT, RATE_WINDOW_MS, wall)
  ) {
    return res.status(429).json({ error: "rate limit exceeded" });
  }

  try {
    if (!(await isRegisteredProvider(address, chainId))) {
      return res.status(403).json({ error: "not a registered OoO provider on that chain" });
    }
    const challenge = await createChallenge(address, chainId, Math.floor(wall / 1000));
    if (!challenge) {
      return res.status(400).json({ error: "unsupported chain" });
    }
    return res.status(200).json(challenge);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err) });
  }
}
