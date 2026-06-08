import { requireAdminApi } from "../../../lib/apiAuth";
import { fetchPoolPrices } from "../../../lib/priceFetch";

import type { NextApiRequest, NextApiResponse } from "next";

// Admin price fetch — LIVE (any `mins` of history), used by the operator
// price-test. Thin wrapper over the shared lib/priceFetch (the public, cached
// equivalent is /api/ooo/v1/prices). The subgraph key comes from the server's env.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAdminApi(req, res))) return;

  const chain = String(req.query?.chain || "");
  const dex = String(req.query?.dex || "");
  const addresses = String(req.query?.addresses || "").split(",").filter(Boolean);
  const minutes = req.query?.mins === undefined ? 0 : parseInt(String(req.query.mins));

  if (!chain || !dex || addresses.length === 0) {
    return res.status(400).json({ success: false, prices: [], chain, dex, addresses: "", error: "Chain, dex and addresses required" });
  }

  const r = await fetchPoolPrices(chain, dex, addresses, minutes);
  return res.status(r.success ? 200 : 400).json({ ...r, chain, dex, addresses: `"${addresses.join('","')}"` });
}
