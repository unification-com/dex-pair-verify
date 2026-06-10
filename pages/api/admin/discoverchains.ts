// Resolve a token (chain, address) to the supported chains where the same coin also
// has a contract (via its CoinGecko platforms map) — the one-hop targets for the
// cross-chain spider. Returns { cgId, siblings: [{ chain, address }] }; empty when
// the token has no CoinGecko id.
import { requireAdminApi } from "../../../lib/apiAuth";
import { siblingsForToken } from "../../../lib/manualAdd";

import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAdminApi(req, res, { methods: ["POST"] }))) return;

  const chain = String(req.body?.chain ?? "").trim();
  const address = String(req.body?.address ?? "").trim();
  if (!chain || !address) {
    return res.status(400).json({ success: false, err: "chain and address are required" });
  }

  try {
    const out = await siblingsForToken(chain, address);
    return res.status(200).json({ success: true, data: out });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, err: String(err) });
  }
}
