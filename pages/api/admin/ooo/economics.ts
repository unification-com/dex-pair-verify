// Admin API (OoO #2): OoO economics — DB aggregates over fulfilments + live provider balances. Thin wrapper
// over lib/oooEconomics so the page (gSSP) and any programmatic caller share one implementation. Operator-gated.
import { requireAdminApi } from "../../../../lib/apiAuth";
import { economicsAggregates, providerBalances } from "../../../../lib/oooEconomics";

import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (!(await requireAdminApi(req, res, { methods: ["GET"] }))) return;
  const [aggregates, balances] = await Promise.all([economicsAggregates(), providerBalances()]);
  res.status(200).json({ success: true, data: { aggregates, balances } });
}
