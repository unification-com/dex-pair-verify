// Manually add one pair by (chain, dex, contract address): ingest it from
// GeckoTerminal + run the verdict inline. The /add page follows up with
// /api/admin/enrichpair to run the verification passes, then spiders. A business
// failure (unknown pool / wrong DEX) returns success:false + a reason for the UI.
import { requireAdminApi } from "../../../lib/apiAuth";
import { addPair } from "../../../lib/manualAdd";

import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAdminApi(req, res, { methods: ["POST"] }))) return;

  const chain = String(req.body?.chain ?? "").trim();
  const dex = String(req.body?.dex ?? "").trim();
  const address = String(req.body?.address ?? "").trim();
  if (!chain || !dex || !address) {
    return res.status(400).json({ success: false, err: "chain, dex and address are required" });
  }

  try {
    const out = await addPair(chain, dex, address);
    if (!out.ok) {
      return res.status(200).json({ success: false, err: out.reason });
    }
    return res.status(200).json({ success: true, data: out.summary });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, err: String(err) });
  }
}
