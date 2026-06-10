// Manually add a token by (chain, contract address): ingest every supported-DEX
// pool that token is in (verdict inline) and return the ids of all pairs that now
// reference it, so the /add page can enrich each. Used both for a direct token-add
// and as the per-chain unit of the cross-chain spider.
import { requireAdminApi } from "../../../lib/apiAuth";
import { addToken } from "../../../lib/manualAdd";

import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAdminApi(req, res, { methods: ["POST"] }))) return;

  const chain = String(req.body?.chain ?? "").trim();
  const address = String(req.body?.address ?? "").trim();
  if (!chain || !address) {
    return res.status(400).json({ success: false, err: "chain and address are required" });
  }

  try {
    const out = await addToken(chain, address);
    if (!out.ok) {
      return res.status(200).json({ success: false, err: out.reason });
    }
    return res.status(200).json({ success: true, data: out });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, err: String(err) });
  }
}
