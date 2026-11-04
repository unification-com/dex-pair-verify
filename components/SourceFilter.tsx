// components/SourceFilter.tsx
// The chain select (plus the DEX select when `sources` is given) shared by the
// list pages. Changing the chain clears the DEX, and the DEX list narrows to the
// chosen chain. Like the search box, a change navigates, so the page re-queries.
import React from "react";

import type { SourceOption } from "../lib/sourceOptions";

type Props = {
  chains: string[];
  chain: string;
  onChange: (over: { chain?: string; dex?: string }) => void;
  sources?: SourceOption[];
  dex?: string;
};

const SourceFilter: React.FC<Props> = ({ chains, chain, onChange, sources, dex }) => (
  <>
    <select className="input" value={chain} onChange={(e) => onChange({ chain: e.target.value, dex: "" })}>
      <option value="">All chains</option>
      {chains.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
    {sources && (
      <select className="input" value={dex ?? ""} onChange={(e) => onChange({ dex: e.target.value })}>
        <option value="">All DEXs</option>
        {sources.filter((s) => !chain || s.chain === chain).map((s) => <option key={`${s.chain}_${s.dex}`} value={s.dex}>{s.dex}{chain ? "" : ` (${s.chain})`}</option>)}
      </select>
    )}
  </>
);

export default SourceFilter;
