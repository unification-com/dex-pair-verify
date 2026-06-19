// Admin API (OoO #3, Part A): the Foundation's on-chain GRT billing balance (Arbitrum). Thin wrapper over
// lib/graphUsage so the page (gSSP) and any programmatic caller share one implementation. Operator-gated.
import { requireAdminApi } from "../../../../lib/apiAuth";
import { graphUsage } from "../../../../lib/graphUsage";

import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (!(await requireAdminApi(req, res, { methods: ["GET"] }))) return;
  const data = await graphUsage();
  res.status(200).json({ success: true, data });
}
