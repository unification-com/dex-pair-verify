import { requireAdminApi } from "../../../lib/apiAuth";
import { verifySubgraphSource } from "../../../lib/subgraphVerify";

import type { NextApiRequest, NextApiResponse } from "next";

// Verify a pasted subgraph URL (Phase 4, 4.A) without persisting anything:
// detect the provider, rewrite the URL to a {API_KEY} template (the literal key
// is never returned), and run a live GraphQL introspection probe to classify the
// schema family. The operator reviews the result before promoting the candidate
// (sourcecandidate.ts). Uses the server's own provider key from env.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAdminApi(req, res))) return;

  const url = String(req.body?.url || "").trim();
  if (!url) {
    return res.status(400).json({ success: false, err: "url required" });
  }

  try {
    const r = await verifySubgraphSource(url);
    // Note: r.template carries the {API_KEY} placeholder, never the literal key.
    return res.status(200).json({
      success: true,
      provider: r.provider,
      template: r.template,
      keyEnvVar: r.keyEnvVar,
      live: r.probe.live,
      schemaFamily: r.probe.schemaFamily,
      queryFields: r.probe.queryFields,
      error: r.probe.error ?? null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, err: String(err) });
  }
}
