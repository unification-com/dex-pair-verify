import React from "react";

// Key/value row used across the pair + token detail pages and their shared data
// boxes. Self-contained styles: styled-jsx doesn't pierce component boundaries,
// so the row styling must live here to render correctly wherever it's dropped.
const KV: React.FC<{ k: React.ReactNode; v: React.ReactNode }> = ({ k, v }) => (
  <div className="kv-row">
    <span className="kv-k muted">{k}</span>
    <span className="kv-v mono">{v}</span>
    <style jsx>{`
      .kv-row { display: flex; justify-content: space-between; gap: var(--sp-4); padding: var(--sp-2) 0; border-bottom: 1px solid var(--border); font-size: var(--fs-sm); }
      .kv-row:last-child { border-bottom: 0; }
      .kv-k { white-space: nowrap; }
      .kv-v { text-align: right; word-break: break-word; }
    `}</style>
  </div>
);

export default KV;
