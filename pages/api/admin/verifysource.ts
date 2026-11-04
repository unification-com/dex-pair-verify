import { requireAdminApi } from "../../../lib/apiAuth";
import { assertSafeSubgraphUrl, UnsafeSubgraphUrlError, verifySubgraphSource } from "../../../lib/subgraphVerify";

import type { NextApiRequest, NextApiResponse } from "next";

// Verify a pasted subgraph URL (Phase 4, 4.A) without persisting anything:
// detect the provider, rewrite the URL to a {API_KEY} template (the literal key
// is never returned), and run a live GraphQL introspection probe to classify the
// schema family. The operator reviews the result before promoting the candidate
// (sourcecandidate.ts). Uses the server's own provider key from env.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAdminApi(req, res, { methods: ["POST"] }))) return;

  const url = String(req.body?.url || "").trim();
  if (!url) {
    return res.status(400).json({ success: false, err: "url required" });
  }
  // SSRF guard: reject non-https / private / loopback hosts before any fetch.
  try {
    assertSafeSubgraphUrl(url);
  } catch (e) {
    return res.status(400).json({ success: false, err: e instanceof UnsafeSubgraphUrlError ? e.message : "invalid subgraph URL" });
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
      // Real-query data probe — confirms the subgraph returns usable pricing rows.
      dataApplicable: r.dataProbe.applicable,
      dataOk: r.dataProbe.ok,
      sampleReserveUsd: r.dataProbe.sampleReserveUsd,
      rowCount: r.dataProbe.rowCount,
      sampleId: r.dataProbe.sampleId,
      samples: r.dataProbe.samples,
      dataError: r.dataProbe.error ?? null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, err: String(err) });
  }
}
