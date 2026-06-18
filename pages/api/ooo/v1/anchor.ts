import { getAnchorLeaf, getAnchorSnapshot, getOnChainAnchor } from "../../../../lib/anchor";
import { clientIp } from "../../../../lib/clientIp";
import { MERKLE_LEAF_VERSION } from "../../../../lib/merkle";
import { rateLimit } from "../../../../lib/rateLimit";

import type { NextApiRequest, NextApiResponse } from "next";

// PUBLIC anchor endpoint (#130) — the Merkle commitment dpv records on-chain via BEACON. This is a POSITIVE
// trust signal (unlike the scam internals), and the leaf facts are already public (chain/dex/contract +
// token identities + status + confidence + canonicalKey). Three shapes:
//   - default            → summary: { root, leafCount, leafVersion, modifiedAt, generatedAt }
//   - ?chain&dex&address  → one pair's { preimage, leaf, proof } so the page badge can verify it
//   - ?full=1             → every leaf with preimage + proof (lets a third party recompute the whole root)
// The snapshot is memoised on the modified-at watermark, so repeated calls are cheap between verdict changes.
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

  const chain = String(req.query?.chain || "");
  const dex = String(req.query?.dex || "");
  const address = String(req.query?.address || "");

  // Per-pair lookup (the badge): return that pair's preimage + proof + the on-chain anchor of its root.
  if (chain && dex && address) {
    const r = await getAnchorLeaf(chain, dex, address);
    if (!r) {
      return res.status(404).json({ success: false, error: "pair not in the current verified anchor set" });
    }
    const onChain = await getOnChainAnchor(r.root);
    return res.status(200).json({ success: true, leafVersion: MERKLE_LEAF_VERSION, root: r.root, modifiedAt: r.modifiedAt, generatedAt: r.generatedAt, onChain, ...r.leaf });
  }

  const snap = await getAnchorSnapshot();
  const onChain = await getOnChainAnchor(snap.root);
  const base = { success: true, leafVersion: MERKLE_LEAF_VERSION, root: snap.root, leafCount: snap.leafCount, modifiedAt: snap.modifiedAt, generatedAt: snap.generatedAt, onChain };

  // Full preimage set — opt-in (it can be large); lets anyone recompute the root + verify any proof.
  if (String(req.query?.full || "") === "1") {
    return res.status(200).json({ ...base, leaves: snap.leaves });
  }

  return res.status(200).json(base);
}
