import { AnchorSnapshot, getAnchorLeaf, getAnchorSnapshot, getOnChainAnchor, getTokenAnchorLeaf, getTokenAnchorSnapshot } from "../../../../lib/anchor";
import { clientIp } from "../../../../lib/clientIp";
import { MERKLE_LEAF_VERSION } from "../../../../lib/merkle";
import { rateLimit } from "../../../../lib/rateLimit";

import type { NextApiRequest, NextApiResponse } from "next";

// PUBLIC anchor endpoint (#130) — the Merkle commitments dpv records on-chain via BEACON. A POSITIVE trust
// signal (the leaf facts are already public). TWO trees, selected by `?tree=pairs|tokens` (default pairs):
//   - default                    → pair-tree summary: { root, leafCount, leafVersion, modifiedAt, onChain }
//   - ?chain&dex&address          → one PAIR's { preimage, leaf, proof, onChain } for the badge to verify
//   - ?tree=tokens                → token-tree summary
//   - ?tree=tokens&chain&address  → one TOKEN's { preimage, leaf, proof, onChain }
//   - &full=1                     → also return every leaf (preimage + proof) so anyone can recompute the root
// Snapshots are memoised on the modified-at watermark, so repeated calls are cheap between verdict changes.
const RATE_LIMIT = 60; // requests
const RATE_WINDOW_MS = 60_000; // per minute, per IP

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, error: "method not allowed" });
  }
  if (!rateLimit(`anchor:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS, Date.now())) {
    return res.status(429).json({ success: false, error: "rate limit exceeded" });
  }

  const tree = String(req.query?.tree || "pairs") === "tokens" ? "tokens" : "pairs";
  const chain = String(req.query?.chain || "");
  const dex = String(req.query?.dex || "");
  const address = String(req.query?.address || "");

  // Per-item lookup (the badge): a pair needs chain+dex+address, a token needs chain+address.
  const wantItem = tree === "tokens" ? Boolean(chain && address) : Boolean(chain && dex && address);
  if (wantItem) {
    const r = tree === "tokens" ? await getTokenAnchorLeaf(chain, address) : await getAnchorLeaf(chain, dex, address);
    if (!r) {
      return res.status(404).json({ success: false, error: `${tree === "tokens" ? "token" : "pair"} not in the current verified anchor set` });
    }
    const onChain = await getOnChainAnchor(r.root);
    return res.status(200).json({ success: true, tree, leafVersion: MERKLE_LEAF_VERSION, root: r.root, modifiedAt: r.modifiedAt, generatedAt: r.generatedAt, onChain, ...r.leaf });
  }

  const snap: AnchorSnapshot = tree === "tokens" ? await getTokenAnchorSnapshot() : await getAnchorSnapshot();
  const onChain = await getOnChainAnchor(snap.root);
  const base = { success: true, tree, leafVersion: MERKLE_LEAF_VERSION, root: snap.root, leafCount: snap.leafCount, modifiedAt: snap.modifiedAt, generatedAt: snap.generatedAt, onChain };

  // Full preimage set — opt-in (it can be large); lets anyone recompute the root + verify any proof.
  if (String(req.query?.full || "") === "1") {
    return res.status(200).json({ ...base, leaves: snap.leaves });
  }

  return res.status(200).json(base);
}
