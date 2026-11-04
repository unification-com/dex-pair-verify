// lib/phantomLiquidity.ts
// "Phantom liquidity" guard. A DEX pool's reserveUsd is derived from the token's
// price; for a garbage-priced / honeypot token that figure can be a phantom — the
// pool reports e.g. $92M reserve while real 24h volume is $7 and nothing can be
// extracted (BGPT, the case that surfaced this). The tell is TURNOVER (24h volume
// ÷ reserve): a pool that LOOKS deep (reserve ≥ floor) but turns over essentially
// nothing is dead or fake, so its reserveUsd is not real, usable liquidity.
//
// Shared by the verdict engine (withhold the liquidity credit → an unidentified
// phantom pool falls to AV-2 auto-reject, an identified one routes to review) and
// the UI fence mirror, so they can't drift.

// Below this 24h turnover (volume ÷ reserve) a deep pool is treated as phantom.
// 0.0001 = under 0.01% of the reserve traded in 24h. The gap to any live pool is
// huge (active pools are ≥ ~1e-2), so this only catches dead/fake pools, never
// quiet-but-active ones.
export const PHANTOM_TURNOVER_FLOOR = 0.0001;

// True when a pool looks deep (reserve ≥ the operator floor) but its 24h turnover
// is below the phantom floor — i.e. the reserveUsd is not real liquidity. Pools
// below the floor are handled by the normal liquidity gate, so they're not phantom.
export function isPhantomLiquidity(reserveUsd: number, volumeUsd: number, minLiquidityUsd: number): boolean {
  if (reserveUsd <= 0 || reserveUsd < minLiquidityUsd) {
    return false;
  }
  // volumeUsd 0 ⇒ turnover 0 ⇒ phantom (a deep pool with literally no 24h volume).
  return volumeUsd / reserveUsd < PHANTOM_TURNOVER_FLOOR;
}

// Whether the phantom-liquidity guard should FIRE for a pool, accounting for the bypass conditions.
// The single gate BOTH the verdict engine (evaluatePair) and the UI fence mirror (deriveFences) call,
// so the bypass set can't drift between them (it did once — reserveTrusted was added to the verdict
// alone, which then showed an AutoVerified Osmosis pair as "Held on: Liquidity meets floor"). Both
// firstParty (OUR token) and reserveTrusted (an authoritative on-chain reserve, e.g. an Osmosis SQS
// liquidity_cap, whose volume feed is unreliable so the turnover signal can't be trusted) waive it.
export function phantomLiquidityApplies(
  reserveUsd: number,
  volumeUsd: number,
  minLiquidityUsd: number,
  opts: { firstParty?: boolean; reserveTrusted?: boolean } = {},
): boolean {
  if (opts.firstParty || opts.reserveTrusted) {
    return false;
  }
  return isPhantomLiquidity(reserveUsd, volumeUsd, minLiquidityUsd);
}
