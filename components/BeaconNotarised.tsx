import React, { useEffect, useState } from "react";

import { ageStr } from "../lib/format";
import { verifyLeafPreimage } from "../lib/merkleVerify";

// ⛓ "Notarised on Mainchain" badge (#130 S3). A POSITIVE public trust signal: the pair (or the whole
// verified set, on a token page) is committed in a Merkle root dpv recorded on the Unification BEACON.
// In `pair` mode it can INDEPENDENTLY verify the pair's proof in-browser (Web Crypto, lib/merkleVerify) —
// recomputing the leaf from the published preimage up to the on-chain-recorded root, trusting no server
// assertion. Renders nothing until/unless the current root is anchored on-chain (no claim = no badge).
type OnChain = { beaconId: number; timestampId: number; txHash: string; submitTime: number; metadata: string };
type AnchorResponse = {
  success: boolean;
  root: string;
  leafCount?: number;
  onChain: OnChain | null;
  preimage?: unknown;
  proof?: { hash: string; position: "left" | "right" }[];
};

// Optional block-explorer tx template (e.g. "https://explorer.unification.io/unification/tx/{hash}").
// Unset → the tx hash renders as plain mono text (correct for a local devnet with no explorer).
const TX_EXPLORER = process.env.NEXT_PUBLIC_BEACON_TX_EXPLORER || "";
const txUrl = (hash: string): string | null => (TX_EXPLORER ? TX_EXPLORER.replace("{hash}", hash) : null);
const short = (s: string, n = 10): string => (s.length > 2 * n ? `${s.slice(0, n)}…${s.slice(-n)}` : s);

const BeaconNotarised: React.FC<{ pair?: { chain: string; dex: string; address: string } }> = ({ pair }) => {
  const [data, setData] = useState<AnchorResponse | null>(null);
  const [verify, setVerify] = useState<"idle" | "checking" | "ok" | "fail">("idle");

  useEffect(() => {
    const ctrl = new AbortController();
    const qs = pair ? `?chain=${encodeURIComponent(pair.chain)}&dex=${encodeURIComponent(pair.dex)}&address=${encodeURIComponent(pair.address)}` : "";
    fetch(`/api/ooo/v1/anchor${qs}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d && d.success ? d : null))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [pair]);

  if (!data || !data.onChain) {
    return null; // not yet anchored on-chain → make no claim
  }
  const oc = data.onChain;

  const runVerify = async (): Promise<void> => {
    if (!data.preimage || !data.proof) {
      return;
    }
    setVerify("checking");
    try {
      const ok = await verifyLeafPreimage(data.preimage, data.proof, data.root);
      setVerify(ok ? "ok" : "fail");
    } catch {
      setVerify("fail");
    }
  };

  const link = txUrl(oc.txHash);

  return (
    <div className="anchor card card-pad">
      <div className="row spread items-center">
        <span className="title">⛓ Notarised on Mainchain</span>
        <span className="muted sm">anchored {ageStr(oc.submitTime)} ago</span>
      </div>
      <div className="kv">
        <span className="muted">{pair ? "This pair is committed in" : `${data.leafCount ?? ""} verified pairs committed in`} Merkle root</span>
        <span className="mono">{short(data.root)}</span>
      </div>
      <div className="kv">
        <span className="muted">BEACON #{oc.beaconId} · timestamp #{oc.timestampId} · tx</span>
        {link ? <a className="mono" href={link} target="_blank" rel="noreferrer">{short(oc.txHash)}</a> : <span className="mono">{short(oc.txHash)}</span>}
      </div>

      {pair && data.preimage && (
        <div className="verify">
          <button type="button" className="btn btn-ghost btn-sm" onClick={runVerify} disabled={verify === "checking"}>
            {verify === "checking" ? "Verifying…" : "Verify proof"}
          </button>
          {verify === "ok" && <span className="ok">✓ proof verified in your browser — this pair is in root {short(data.root, 6)}</span>}
          {verify === "fail" && <span className="fail">✗ verification failed</span>}
          {verify === "idle" && <span className="muted sm">recomputes the Merkle proof locally (Web Crypto) — no need to trust this server</span>}
        </div>
      )}

      <style jsx>{`
        .anchor { border-color: var(--accent-line); background: var(--accent-dim, rgba(80,160,255,.06)); margin-bottom: var(--sp-5); }
        .title { font-weight: 700; color: var(--accent-text, var(--text-0)); }
        .sm { font-size: var(--fs-xs); }
        .kv { display: flex; justify-content: space-between; gap: var(--sp-4); padding: var(--sp-2) 0; border-top: 1px solid var(--border); font-size: var(--fs-sm); margin-top: var(--sp-3); }
        .kv:first-of-type { margin-top: var(--sp-4); }
        .verify { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; margin-top: var(--sp-4); font-size: var(--fs-sm); }
        .ok { color: var(--pass, #2ecc71); font-weight: 600; }
        .fail { color: var(--fail, #e74c3c); font-weight: 600; }
      `}</style>
    </div>
  );
};

export default BeaconNotarised;
