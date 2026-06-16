// lib/aliasGroups.ts
// Asset-class alias groups (T13 → go-ooo S7 / XR4). An alias group names a canonical asset class (USD,
// ETH, BTC) whose members are CoinGecko coin ids that are GENUINELY FUNGIBLE for pricing — wrapped /
// bridged / chain-native forms of the same unit of value, all trading ~1:1. go-ooo's robust aggregator
// expands an alias query (e.g. `ETH.USD`) to every member pool and prices them as one deep, robust
// estimate; the median+MAD smooths minor variance and rejects a depegged member as an outlier.
//
// SAFETY — this curation IS the trust boundary. go-ooo TRUSTS these groups; it does not curate them.
// Members must be fungible-for-pricing ONLY. Deliberately EXCLUDED, even though they look related:
//   - staked / restaked / yield-bearing derivatives: wstETH, cbETH, rETH, weETH, ezETH, frxETH, sUSDe,
//     LBTC — they trade at a premium/discount, so they are a DIFFERENT asset, not a fungible form.
//   - algorithmic / synthetic / riskier stables: USDe, USD0, alUSD, eUSD, FRAX (fractional-algo) —
//     higher depeg risk; keep the USD class to the rock-solid + fully-backed bridged forms.
//   - dead / depegged: terrausd (USTC).
//   - false friends: tether-gold (XAUt — that's GOLD), ethena / ethereum-name-service / etc.
// When in doubt, LEAVE IT OUT — a missing member just means that pool isn't in the class aggregate; a
// wrong member poisons every class price that uses it.
//
// Discovery aid: the verified-token cg-id families (run a one-off group-by on `coingeckoCoinId`) surface
// candidates, but every addition is a hand judgement against the fungibility test above.

// alias symbol → member CoinGecko coin ids (fungible-only). Operator-curated; extend conservatively.
export const ALIAS_GROUPS: Record<string, string[]> = {
  // The US-dollar class: USDC + USDT + DAI + the fully-backed majors, plus their chain/bridge variants
  // that CoinGecko gives a DISTINCT coin id (same-id variants like USDC.e→usd-coin already collapse via
  // the canonical key, so they need no listing here).
  USD: [
    "usd-coin", "tether", "dai", "true-usd", "paypal-usd", "liquity-usd", "usds",
    // USDC bridged/chain variants with their own cg id:
    "usd-coin-ethereum-bridged", "bridged-usd-coin-base", "bridged-usd-coin-optimism",
    "bridged-usdc-polygon-pos-bridge", "binance-bridged-usdc-bnb-smart-chain",
    "gnosis-xdai-bridged-usdc-gnosis", "axlusdc",
    // USDT bridged/chain variants with their own cg id:
    "binance-bridged-usdt-bnb-smart-chain", "bridged-usdt", "l2-standard-bridged-usdt-base", "usdt0",
  ],
  // The ether class: native ETH + WETH + its 1:1 bridged forms. NO staked/restaked derivatives.
  ETH: [
    "ethereum", "weth", "axlweth", "binance-peg-weth",
    "arbitrum-bridged-weth-arbitrum-one", "l2-standard-bridged-weth-base",
    "l2-standard-bridged-weth-optimism", "polygon-pos-bridged-weth-polygon-pos",
    "gnosis-xdai-bridged-weth-gnosis-chain",
  ],
  // The bitcoin class: BTC + its 1:1 wrapped/bridged forms. NO staked derivatives (e.g. LBTC).
  BTC: [
    "bitcoin", "wrapped-bitcoin", "coinbase-wrapped-btc", "binance-bitcoin", "kraken-wrapped-btc",
    "tbtc", "avalanche-bridged-btc-arbitrum-one",
    "arbitrum-bridged-wbtc-arbitrum-one", "polygon-bridged-wbtc-polygon-pos",
    "gnosis-xdai-bridged-wbtc-gnosis-chain",
    // NB: renBTC deliberately OMITTED — Ren Protocol is defunct (no reliable mint/redeem), so it is no
    // longer a trustworthy 1:1 BTC form.
  ],
};

// Reverse index: cg id → its alias symbol. Built once; also enforces the invariant that no cg id is a
// member of two groups (that would make a pair's class ambiguous) — a config error throws at load.
const CG_ID_TO_ALIAS: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [alias, cgIds] of Object.entries(ALIAS_GROUPS)) {
    for (const raw of cgIds) {
      const cg = raw.trim().toLowerCase();
      const existing = m.get(cg);
      if (existing && existing !== alias) {
        throw new Error(`aliasGroups: cg id "${cg}" is in two groups (${existing} + ${alias}) — a cg id may belong to at most one alias class`);
      }
      m.set(cg, alias);
    }
  }
  return m;
})();

// The set of alias symbols (USD, ETH, BTC, …), upper-cased as queried.
export const ALIAS_SYMBOLS: ReadonlySet<string> = new Set(Object.keys(ALIAS_GROUPS));

// Is `symbol` a queryable alias class? (Case-insensitive.)
export const isAliasSymbol = (symbol: string): boolean => ALIAS_SYMBOLS.has(symbol.trim().toUpperCase());

// The alias class a cg id belongs to, or null if it's not a curated member.
export const aliasForCgId = (cgId: string | null | undefined): string | null =>
  CG_ID_TO_ALIAS.get((cgId ?? "").trim().toLowerCase()) ?? null;

// The member cg ids of an alias class, or [] for a non-alias symbol.
export const membersOfAlias = (symbol: string): string[] => ALIAS_GROUPS[symbol.trim().toUpperCase()] ?? [];
