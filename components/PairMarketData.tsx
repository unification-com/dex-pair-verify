import React from "react";

import NativeToken from "./NativeToken";
import { usd, num as fmtNum } from "../lib/format";
import KV from "./ui/KV";

// Detail boxes show 2 dp; the shared formatter defaults to 0.
const num = (n: number | null | undefined) => fmtNum(n, 2);

// The market-data fields both the operator and public pair detail views display.
export type PairMarketFields = {
  chain: string;
  token0: { symbol: string };
  token1: { symbol: string };
  marketCapUsd: number;
  token0PriceCg: number | string | null;
  token1PriceCg: number | string | null;
  priceChangePercentage24h: number;
  volumeUsd24h: number;
  reserveUsd: number;
  reserve0: number;
  reserve1: number;
  reserveNativeCurrency: number;
  volumeUsd: number;
  txCount: number;
  buys24h: number;
  buyers24h: number;
  sells24h: number;
  sellers24h: number;
};

// CoinGecko market data + DEX subgraph reserves + 24h activity, shared by the
// operator and public pair detail. Expanded by default (operator preference);
// the <details> chrome still lets a reader collapse a box.
const PairMarketData: React.FC<{ pair: PairMarketFields }> = ({ pair }) => (
  <>
    <details className="card raw" open>
      <summary>CoinGecko market data</summary>
      <div className="kv-grid">
        <KV k="Market cap" v={usd(pair.marketCapUsd)} />
        <KV k={`${pair.token0.symbol} price`} v={`${num(Number(pair.token0PriceCg))} ${pair.token1.symbol}`} />
        <KV k={`${pair.token1.symbol} price`} v={`${num(Number(pair.token1PriceCg))} ${pair.token0.symbol}`} />
        <KV k="24h change" v={`${num(pair.priceChangePercentage24h)}%`} />
        <KV k="24h volume" v={usd(pair.volumeUsd24h)} />
      </div>
    </details>

    <details className="card raw" open>
      <summary>DEX subgraph reserves</summary>
      <div className="kv-grid">
        <KV k="Reserve USD" v={usd(pair.reserveUsd)} />
        <KV k="Reserve native" v={<>{num(pair.reserveNativeCurrency)} <NativeToken chain={pair.chain} /></>} />
        <KV k={`Reserve ${pair.token0.symbol}`} v={num(pair.reserve0)} />
        <KV k={`Reserve ${pair.token1.symbol}`} v={num(pair.reserve1)} />
        <KV k="Volume USD" v={usd(pair.volumeUsd)} />
        <KV k="Tx count" v={num(pair.txCount)} />
      </div>
    </details>

    <details className="card raw" open>
      <summary>24h activity</summary>
      <div className="kv-grid">
        <KV k="Buys" v={num(pair.buys24h)} />
        <KV k="Buyers" v={num(pair.buyers24h)} />
        <KV k="Sells" v={num(pair.sells24h)} />
        <KV k="Sellers" v={num(pair.sellers24h)} />
      </div>
    </details>

    <style jsx>{`
      .raw { padding: var(--sp-4) var(--sp-5); }
      .raw > summary { cursor: pointer; font-weight: 600; font-size: var(--fs-sm); color: var(--text-1); }
      .kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 var(--sp-7); padding-top: var(--sp-3); }
    `}</style>
  </>
);

export default PairMarketData;
