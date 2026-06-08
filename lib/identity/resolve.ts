// Token-identity resolver (T1). Runs the configured identity sources for one
// token and aggregates them into a TokenIdentityResult. Network calls are
// injectable so this is unit-testable without hitting any API.
//
// Runs only for tokens lacking a CoinGecko coin id — CG-listed tokens are
// already "identified" via cgId, so the verdict engine never needs this for
// them (the DB-backed identityCheck pass enforces that scoping).

import { aggregateIdentity } from "./aggregate";
import { CgReverseFetcher, coingeckoReverseIdentity } from "./sources/coingecko";
import { CmcReverseFetcher, coinmarketcapReverseIdentity } from "./sources/coinmarketcap";
import { deriveGoplusIdentity } from "./sources/goplus";
import { tokenListMembership, tokenListSignal } from "./sources/tokenlist";
import { TrustWalletFetcher, trustWalletIdentity } from "./sources/trustwallet";
import { IdentitySignal, TokenIdentityResult } from "./types";
import { evmChainId } from "../chains";
import { fetchTokenSecurity, goplusChainId, TokenSecurity } from "../scamCheck";

export type ResolveDeps = {
  // Injectable for tests; default to the real token-list + GoPlus + CoinGecko calls.
  listMembership?: (chainId: number, address: string) => Promise<string[]>;
  fetchSecurity?: (chainId: string, address: string) => Promise<TokenSecurity | null>;
  cgReverse?: CgReverseFetcher;
  trustWallet?: TrustWalletFetcher;
  cmcReverse?: CmcReverseFetcher;
};

export type ResolveOpts = ResolveDeps & {
  now: number;
  // GoPlus data already stored on the Token (from a prior scan-check) — reused
  // instead of re-fetching when present (the operator-chosen "fetch if not
  // cached" path).
  existingSecurity?: TokenSecurity | null;
};

export async function resolveTokenIdentity(
  chain: string,
  address: string,
  opts: ResolveOpts,
): Promise<{ result: TokenIdentityResult; security: TokenSecurity | null; coingeckoCoinId: string | null; coinmarketcapSlug: string | null }> {
  const { now } = opts;
  const listMembership = opts.listMembership ?? ((cid, a) => tokenListMembership(cid, a, { now }));
  const fetchSecurity = opts.fetchSecurity ?? fetchTokenSecurity;

  const signals: IdentitySignal[] = [];

  // CoinGecko reverse contract lookup — the most authoritative source; also yields
  // a coin id for the caller to backfill onto the token.
  const cg = await coingeckoReverseIdentity(chain, address, opts.cgReverse);
  signals.push(cg.signal);

  // Token-list source — needs an EVM numeric chain id.
  const evmId = evmChainId(chain);
  if (evmId !== null) {
    const matched = await listMembership(evmId, address);
    signals.push(tokenListSignal(matched));
  }

  // Trust Wallet curated asset registry — another self-sufficient tokenlist-class
  // source (positive-only; skips chains it doesn't map).
  signals.push(await trustWalletIdentity(chain, address, opts.trustWallet));

  // CoinMarketCap reverse contract lookup — the second major aggregator, also
  // self-sufficient (no key ⇒ no-ops; EVM chains only). Yields the CMC slug for
  // the caller to backfill (token-page link).
  const cmc = await coinmarketcapReverseIdentity(chain, address, opts.cmcReverse);
  signals.push(cmc.signal);

  // GoPlus source — reuse stored security data, else fetch once.
  let security = opts.existingSecurity ?? null;
  const gpChainId = goplusChainId(chain);
  if (!security && gpChainId) {
    security = await fetchSecurity(gpChainId, address);
  }
  signals.push(deriveGoplusIdentity(security));

  return { result: aggregateIdentity(signals, now), security, coingeckoCoinId: cg.coinId, coinmarketcapSlug: cmc.slug };
}
