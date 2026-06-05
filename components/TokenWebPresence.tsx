import React from "react";

import { num as fmtNum } from "../lib/format";
import { TokenWebPresence as Web } from "../lib/tokenWebPresence";
import KV from "./ui/KV";

const num = (n: number | null | undefined) => fmtNum(n, 0);
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

// GeckoTerminal web/socials + Blockscout holders, write-through cached on the
// token row. Decision support, not a trust gate. Shared by the operator and
// public token detail; renders nothing when there's no data to show.
const TokenWebPresence: React.FC<{ web: Web }> = ({ web }) => {
  const hasData =
    web.websites.length > 0 || !!web.twitter || !!web.telegram || !!web.discord || !!web.description || web.holders != null;
  if (!hasData) return null;

  return (
    <div className="card card-pad">
      <div className="row spread items-center" style={{ marginBottom: "var(--sp-3)" }}>
        <span className="eyebrow">Web presence</span>
        <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>decision support · not a trust gate</span>
      </div>
      <div className="row gap-4 items-start wrap">
        {web.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote token logo from GeckoTerminal
          <img src={web.imageUrl} alt="" width={40} height={40} style={{ borderRadius: 8, flex: "none" }} />
        ) : null}
        <div className="col gap-3" style={{ flex: 1, minWidth: 0 }}>
          {web.description ? <p className="muted" style={{ fontSize: "var(--fs-sm)", margin: 0 }}>{web.description}</p> : null}
          <div className="row gap-4 wrap" style={{ fontSize: "var(--fs-sm)" }}>
            {web.websites.map((w, i) => <a key={`web_${i}`} href={w} target="_blank" rel="noreferrer">{hostOf(w)}</a>)}
            {web.twitter ? <a href={web.twitter} target="_blank" rel="noreferrer">Twitter</a> : null}
            {web.telegram ? <a href={web.telegram} target="_blank" rel="noreferrer">Telegram</a> : null}
            {web.discord ? <a href={web.discord} target="_blank" rel="noreferrer">Discord</a> : null}
            {web.websites.length === 0 && !web.twitter && !web.telegram && !web.discord ? <span className="muted">no links on GeckoTerminal</span> : null}
          </div>
        </div>
      </div>
      <div className="kv-grid" style={{ marginTop: "var(--sp-3)" }}>
        <KV k="Holders (Blockscout)" v={web.holders != null ? num(web.holders) : "—"} />
        <KV k="Transfers" v={web.transfers != null ? num(web.transfers) : "—"} />
      </div>
      <style jsx>{`
        .kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 var(--sp-7); padding-top: var(--sp-3); }
      `}</style>
    </div>
  );
};

export default TokenWebPresence;
