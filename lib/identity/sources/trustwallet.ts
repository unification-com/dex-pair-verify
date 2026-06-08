// Trust Wallet assets identity source (T1, B1c). Trust Wallet maintains a
// curated, human-reviewed per-chain asset registry where each listed token has
// its own `assets/<checksumAddress>/info.json` file. A 200 on that file means
// the exact contract is in the vetted set — the same self-sufficient "curated
// token list" class as Uniswap/CoinGecko lists, so a listing alone confirms
// identity (spoof/impostor tokens are excluded from the registry).
//
// This is a POSITIVE-ONLY signal: a 404 / network failure degrades to "not
// listed" (never an error, never a false positive), so the token must then be
// vouched for by another source — exactly how the token-list source degrades.
// We rejected the bundled `tokenlist.json` route (newer chains' entries omit
// chainId, so the standard parser silently skips them, and the lists are tiny);
// the per-address file is the authoritative membership test.

import { utils as web3Utils } from "web3";

import { fetchWithBackoff } from "../../httpBackoff";
import { IdentitySignal } from "../types";

// Our internal chain key → Trust Wallet `blockchains/<folder>` directory name.
// Only the chains we map; an unmapped chain skips the source (no fetch). Folder
// names verified live against the repo (2026-06-08).
const TRUSTWALLET_FOLDER: Record<string, string> = {
  eth: "ethereum",
  bsc: "smartchain",
  polygon_pos: "polygon",
  xdai: "xdai",
  arbitrum: "arbitrum",
  base: "base",
  optimism: "optimism",
};

const assetInfoUrl = (folder: string, checksumAddress: string): string =>
  `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${folder}/assets/${checksumAddress}/info.json`;

// Injectable for tests. true = the curated info.json exists (listed); false =
// absent / unreachable (degraded to "not listed"). A HEAD avoids pulling the
// body — we only need the existence of the file, not its contents.
export type TrustWalletFetcher = (folder: string, checksumAddress: string) => Promise<boolean>;

const defaultTrustWalletFetch: TrustWalletFetcher = async (folder, checksumAddress) => {
  // fetchWithBackoff maps any non-2xx (incl. an expected 404 for an unlisted
  // token, which it stays quiet about) and network errors to null, so a
  // non-null Response means a 200 = the file exists.
  const res = await fetchWithBackoff(assetInfoUrl(folder, checksumAddress), { method: "HEAD" }, `trustwallet ${folder}`);
  return res !== null;
};

// Look the contract up in Trust Wallet's curated registry. A match confirms the
// self-sufficient `tokenlist` category.
export async function trustWalletIdentity(
  chain: string,
  address: string,
  fetcher: TrustWalletFetcher = defaultTrustWalletFetch,
): Promise<IdentitySignal> {
  const notListed: IdentitySignal = {
    source: "trustwallet",
    category: "tokenlist",
    confirmed: false,
    detail: "not in the Trust Wallet asset registry",
  };

  const folder = TRUSTWALLET_FOLDER[chain];
  if (!folder) {
    return notListed;
  }

  // Trust Wallet stores assets under their EIP-55 checksummed address; a
  // lower/upper-case path 404s. Guard the checksum — a malformed address
  // degrades to "not listed" rather than throwing.
  let checksumAddress: string;
  try {
    checksumAddress = web3Utils.toChecksumAddress(address);
  } catch {
    return notListed;
  }

  const listed = await fetcher(folder, checksumAddress);
  return listed
    ? { source: "trustwallet", category: "tokenlist", confirmed: true, detail: "listed in the Trust Wallet asset registry" }
    : notListed;
}
