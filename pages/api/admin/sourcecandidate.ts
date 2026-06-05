import { utils as web3Utils } from "web3";

import { requireAdminApi } from "../../../lib/apiAuth";
import prisma from "../../../lib/prisma";
import { getSources } from "../../../lib/sourceConfig";
import { detectProvider } from "../../../lib/subgraphVerify";
import { CandidateStatus } from "../../../types/types";

import type { NextApiRequest, NextApiResponse } from "next";

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

// Promote a discovered candidate into SupportedSource, or reject it (Phase 4,
// 4.A / D4). Promote writes the DB-backed source of truth (operator-confirmed
// operational fields) and marks the candidate Enabled; reject marks it Rejected
// so discovery stops re-surfacing it. One handler, action-dispatched (cf.
// bulkpairaction.ts) so the auth gate + candidate lookup are shared.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAdminApi(req, res))) return;

  const b = req.body || {};
  const action = String(b.action || "");
  const candidateId = String(b.candidateId || "");
  if (!candidateId) {
    return res.status(400).json({ success: false, err: "candidateId required" });
  }

  try {
    const candidate = await prisma.candidateDexNetwork.findUnique({ where: { id: candidateId } });
    if (!candidate) {
      return res.status(404).json({ success: false, err: "candidate not found" });
    }

    if (action === "reject") {
      await prisma.candidateDexNetwork.update({
        where: { id: candidateId },
        data: { status: CandidateStatus.Rejected },
      });
      return res.status(200).json({ success: true });
    }

    if (action === "promote") {
      const chain = String(b.chain || "").trim();
      const dex = String(b.dex || "").trim();
      const subgraphUrlTemplate = String(b.subgraphUrlTemplate || "").trim();
      const subgraphProvider = String(b.subgraphProvider || "").trim();
      const subgraphSchemaFamily = String(b.subgraphSchemaFamily || "").trim();
      const apiKeyEnvVar = String(b.apiKeyEnvVar || "").trim();
      const rawFactory = String(b.factoryAddress || "").trim();

      if (!chain || !dex || !subgraphUrlTemplate || !subgraphProvider || !subgraphSchemaFamily) {
        return res.status(400).json({
          success: false,
          err: "chain, dex, subgraphUrlTemplate, subgraphProvider and subgraphSchemaFamily are required",
        });
      }

      // Security guard: a decentralized-gateway URL MUST be templated — never
      // persist a literal API key (4.A.subgraph-verification). The verify step
      // produces the placeholder; this catches a hand-edited literal slipping in.
      if (detectProvider(subgraphUrlTemplate) === "graph-decentralized" && !subgraphUrlTemplate.includes("{API_KEY}")) {
        return res.status(400).json({
          success: false,
          err: "decentralized subgraph URL must use the {API_KEY} placeholder, not a literal key",
        });
      }

      let factoryAddress: string;
      try {
        factoryAddress = web3Utils.toChecksumAddress(rawFactory);
      } catch {
        return res.status(400).json({ success: false, err: "factoryAddress must be a valid 0x address" });
      }

      const now = nowSeconds();
      const source = await prisma.supportedSource.upsert({
        where: { chain_dex: { chain, dex } },
        create: {
          chain,
          dex,
          subgraphUrlTemplate,
          subgraphProvider,
          subgraphSchemaFamily,
          apiKeyEnvVar: apiKeyEnvVar || null,
          factoryAddress,
          lastVerifiedAt: now,
          enabledAt: now,
        },
        update: {
          subgraphUrlTemplate,
          subgraphProvider,
          subgraphSchemaFamily,
          apiKeyEnvVar: apiKeyEnvVar || null,
          factoryAddress,
          lastVerifiedAt: now,
        },
      });

      await prisma.candidateDexNetwork.update({
        where: { id: candidateId },
        data: { status: CandidateStatus.Enabled },
      });

      // Refresh the in-process source cache so the pipeline picks up the new source
      // without a restart (T6.5).
      await getSources(true);

      return res.status(200).json({ success: true, data: source });
    }

    return res.status(400).json({ success: false, err: `unknown action: ${action}` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, err: String(err) });
  }
}
