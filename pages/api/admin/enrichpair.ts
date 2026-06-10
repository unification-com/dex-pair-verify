// Run the full per-pair verification (factory + both tokens' identity / canonical /
// scam checks + verdict) on one already-ingested pair. The bounded worker the /add
// page loops over for the primary pair and every spidered pair.
import { requireAdminApi } from "../../../lib/apiAuth";
import { enrichPair } from "../../../lib/manualAdd";

import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAdminApi(req, res, { methods: ["POST"] }))) return;

  const pairId = String(req.body?.pairid ?? "").trim();
  if (!pairId) {
    return res.status(400).json({ success: false, err: "pairid is required" });
  }

  try {
    const summary = await enrichPair(pairId);
    if (!summary) {
      return res.status(200).json({ success: false, err: "pair not found" });
    }
    return res.status(200).json({ success: true, data: summary });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, err: String(err) });
  }
}
