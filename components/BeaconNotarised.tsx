import React, { useEffect, useState } from "react";

import { ageStr } from "../lib/format";
import { traceLeafPreimage, VerifyTrace } from "../lib/merkleVerify";

// ⛓ "Notarised on Mainchain" — a SLIM, collapsed-by-default trust chip (#130 S3). Expands to show the
// on-chain anchor (BEACON #, timestamp #, tx) and, in `pair` mode, an in-browser proof check that walks
// the actual Merkle branches leaf→root (Web Crypto, lib/merkleVerify) and shows every hash step — so it is
// a real reconstruction, not a server-asserted "✓". Renders nothing until the current root is anchored.
type OnChain = { beaconId: number; timestampId: number; txHash: string; submitTime: number; metadata: string; tree: string };
type AnchorResponse = {
  success: boolean;
  tree?: string;
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
const short = (s: string, n = 8): string => (s.length > 2 * n ? `${s.slice(0, n)}…${s.slice(-n)}` : s);

const BeaconNotarised: React.FC<{ pair?: { chain: string; dex: string; address: string }; token?: { chain: string; address: string } }> = ({ pair, token }) => {
  const [data, setData] = useState<AnchorResponse | null>(null);
  const [trace, setTrace] = useState<VerifyTrace | null>(null);
  const [busy, setBusy] = useState(false);
  const item = Boolean(pair || token);

  useEffect(() => {
    const ctrl = new AbortController();
    const qs = pair
      ? `?chain=${encodeURIComponent(pair.chain)}&dex=${encodeURIComponent(pair.dex)}&address=${encodeURIComponent(pair.address)}`
      : token
        ? `?tree=tokens&chain=${encodeURIComponent(token.chain)}&address=${encodeURIComponent(token.address)}`
        : "";
    fetch(`/api/ooo/v1/anchor${qs}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d && d.success ? d : null))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [pair, token]);

  if (!data || !data.onChain) {
    return null; // not yet anchored on-chain → make no claim
  }
  const oc = data.onChain;
  const link = txUrl(oc.txHash);

  const runVerify = async (): Promise<void> => {
    if (!data.preimage || !data.proof) {
      return;
    }
    setBusy(true);
    try {
      setTrace(await traceLeafPreimage(data.preimage, data.proof, data.root));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="anchor">
      <summary>
        <span className="chip">⛓ Notarised on Mainchain</span>
        <span className="muted meta">root <span className="mono">{short(data.root)}</span> · {ageStr(oc.submitTime)} ago</span>
      </summary>

      <div className="body">
        <p className="muted meta" style={{ margin: 0 }}>
          {pair ? "This pair is committed in" : token ? "This token is committed in" : `${data.leafCount ?? ""} verified ${data.tree ?? "pairs"} are committed in`} Merkle root{" "}
          <span className="mono">{short(data.root)}</span>, recorded on BEACON #{oc.beaconId} as timestamp #{oc.timestampId}
          {oc.metadata ? ` (${oc.metadata})` : ""}. Tx{" "}
          {link ? <a className="mono" href={link} target="_blank" rel="noreferrer">{short(oc.txHash)}</a> : <span className="mono">{short(oc.txHash)}</span>}.
        </p>

        {item && data.preimage && data.proof && (
          <div className="verify">
            <button type="button" className="btn btn-ghost btn-sm" onClick={runVerify} disabled={busy}>
              {busy ? "Verifying…" : trace ? "Re-verify" : "Verify proof in your browser"}
            </button>

            {trace && (
              <div className="trace mono">
                <div className="trow"><span className="lbl">leaf</span><span className="hx" title={trace.leaf}>{short(trace.leaf, 10)}</span><span className="note">= sha256(this {token ? "token" : "pair"}&apos;s committed facts)</span></div>
                {trace.steps.map((s, i) => (
                  <div className="trow" key={i}>
                    <span className="lbl">+ sibling {s.position === "left" ? "◀ left" : "right ▶"}</span>
                    <span className="hx muted" title={s.sibling}>{short(s.sibling, 10)}</span>
                    <span className="arr">→</span>
                    <span className="hx" title={s.result}>{short(s.result, 10)}</span>
                  </div>
                ))}
                <div className={`trow res ${trace.ok ? "ok" : "fail"}`}>
                  <span className="lbl">{trace.ok ? "✓ computed root" : "✗ computed root"}</span>
                  <span className="hx" title={trace.computedRoot}>{short(trace.computedRoot, 10)}</span>
                  <span className="note">{trace.ok ? "= the root recorded on Mainchain" : "≠ the on-chain root"}</span>
                </div>
              </div>
            )}
            {trace?.ok && (
              <p className="okline">Recomputed locally from the published {token ? "token" : "pair"} data through {trace.steps.length} hash steps — it matches the root on Mainchain, so this {token ? "token" : "pair"} was provably in the anchored set. No need to trust this server.</p>
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        .anchor { font-size: var(--fs-sm); margin: var(--sp-5) 0 0; }
        .anchor > summary { list-style: none; cursor: pointer; display: inline-flex; align-items: center; gap: var(--sp-3); padding: 4px 12px; border: 1px solid var(--border); border-radius: var(--r-pill); background: var(--surface-2, rgba(127,127,127,.05)); width: fit-content; }
        .anchor > summary::-webkit-details-marker { display: none; }
        .anchor > summary:hover { border-color: var(--accent-line, var(--border)); }
        .chip { font-weight: 600; color: var(--text-1); }
        .meta { font-size: var(--fs-xs); }
        .body { margin-top: var(--sp-3); padding: var(--sp-4); border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface-2, rgba(127,127,127,.04)); display: flex; flex-direction: column; gap: var(--sp-4); max-width: 760px; }
        .verify { display: flex; flex-direction: column; gap: var(--sp-3); align-items: flex-start; }
        .trace { display: flex; flex-direction: column; gap: 2px; font-size: var(--fs-xs); padding: var(--sp-3); border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-0, rgba(0,0,0,.18)); overflow-x: auto; width: 100%; }
        .trow { display: flex; gap: var(--sp-3); align-items: baseline; white-space: nowrap; }
        .lbl { color: var(--text-2); min-width: 124px; }
        .hx { color: var(--text-0); }
        .arr { color: var(--text-2); }
        .note { color: var(--text-2); }
        .res.ok .lbl { color: var(--pass, #2ecc71); }
        .res.fail .lbl { color: var(--fail, #e74c3c); }
        .okline { font-size: var(--fs-xs); color: var(--pass, #2ecc71); margin: 0; max-width: 720px; }
      `}</style>
    </details>
  );
};

export default BeaconNotarised;
