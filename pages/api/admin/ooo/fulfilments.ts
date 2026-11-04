// Admin API (OoO #1): paginated, filterable OoO fulfilment history. Thin wrapper over lib/fulfilments so the
// page (gSSP) and any programmatic caller share one implementation. Operator-gated.
import { requireAdminApi } from "../../../../lib/apiAuth";
import { fulfilmentFilterOptions, listFulfilments } from "../../../../lib/fulfilments";
import { cleanParam, pageParam } from "../../../../lib/queryParams";

import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (!(await requireAdminApi(req, res, { methods: ["GET"] }))) return;

  const chainStr = cleanParam(req.query?.chainId);
  const chainId = chainStr ? Number(chainStr) : null;

  const result = await listFulfilments({
    filters: {
      provider: cleanParam(req.query?.provider),
      chainId: chainId != null && Number.isFinite(chainId) ? chainId : null,
      pair: cleanParam(req.query?.pair),
    },
    page: pageParam(req.query?.page),
    sort: cleanParam(req.query?.sort),
    dir: cleanParam(req.query?.dir),
  });
  const filterOptions = await fulfilmentFilterOptions();
  res.status(200).json({ success: true, data: { ...result, filterOptions } });
}
