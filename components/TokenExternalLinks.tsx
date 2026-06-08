import React from "react";

import { blockscoutTokenUrl, coinmarketcapUrl, dexscreenerUrl, goPlusUrl, honeypotUrl } from "../lib/externalLinks";

// Deep-links to the external tools we consult, so the operator can click straight
// through to each source's own UI for the token under review (GoPlus's full signal
// list, the Honeypot.is simulation, DexScreener's chart/socials, Blockscout's
// holder list, the CoinMarketCap page). All deterministic from (chain, address) +
// the backfilled CMC slug — no fetch/storage. Decision support. Renders nothing
// when no tool supports the chain. Shared by the operator + public token detail.
const TokenExternalLinks: React.FC<{ chain: string; address: string; coinmarketcapSlug?: string | null }> = ({
  chain,
  address,
  coinmarketcapSlug,
}) => {
  const candidates: [string, string | null][] = [
    ["GoPlus", goPlusUrl(chain, address)],
    ["Honeypot.is", honeypotUrl(chain, address)],
    ["DexScreener", dexscreenerUrl(chain, address)],
    ["Blockscout", blockscoutTokenUrl(chain, address)],
    ["CoinMarketCap", coinmarketcapUrl(coinmarketcapSlug)],
  ];
  const links = candidates.filter((c): c is [string, string] => c[1] !== null);
  if (links.length === 0) return null;

  return (
    <div className="card card-pad">
      <span className="eyebrow" style={{ display: "block", marginBottom: "var(--sp-3)" }}>Check on external tools</span>
      <div className="row gap-4 wrap" style={{ fontSize: "var(--fs-sm)" }}>
        {links.map(([label, url]) => (
          <a key={label} href={url} target="_blank" rel="noreferrer">{label} ↗</a>
        ))}
      </div>
    </div>
  );
};

export default TokenExternalLinks;
