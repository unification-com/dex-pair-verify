import { requireAdminApi } from "../../../lib/apiAuth";
import { runSecurityScanForToken } from "../../../lib/securitySignals";

import type { NextApiRequest, NextApiResponse } from "next";

// On-demand security scan for one token (the operator "Run security scan" button).
// Force-runs GoPlus + Honeypot.is + Etherscan source-verified, bypassing the batch
// gates that skip unverified-pool / not-on-CoinGecko tokens — so a borderline token
// under review gets a real read.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAdminApi(req, res))) return;

  const tokenid = String(req.body?.tokenid || "");
  if (!tokenid) {
    return res.status(400).json({ success: false, err: "tokenid required" });
  }

  try {
    const out = await runSecurityScanForToken(tokenid);
    if (!out.ok) {
      return res.status(400).json({ success: false, err: out.error });
    }
    return res.status(200).json({ success: true, scam: out.scam, signals: out.signals });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, err: String(e) });
  }
}
