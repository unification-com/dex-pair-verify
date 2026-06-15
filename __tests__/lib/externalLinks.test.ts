// Unit tests for the pure external-tool deep-link builders.

import { describe, expect, it } from "vitest";

import { blockExplorerUrl, blockscoutTokenUrl, coinmarketcapUrl, dexscreenerUrl, goPlusUrl, honeypotUrl } from "../../lib/externalLinks";

const ADDR = "0x3bf3A8f82E54F376d882f99653B42eD6d0CcFc50";

describe("blockExplorerUrl", () => {
  it("builds a token/address link on the chain's explorer (incl. the L2s)", () => {
    expect(blockExplorerUrl("eth", "token", ADDR)).toBe(`https://etherscan.io/token/${ADDR}`);
    expect(blockExplorerUrl("arbitrum", "address", ADDR)).toBe(`https://arbiscan.io/address/${ADDR}`);
    expect(blockExplorerUrl("base", "token", ADDR)).toBe(`https://basescan.org/token/${ADDR}`);
  });
  it("returns null for a chain with no block explorer (e.g. a Cosmos denom), so the UI shows plain text", () => {
    expect(blockExplorerUrl("osmosis", "token", "factory/osmo1.../alloyed/allBTC")).toBeNull();
  });
});

describe("goPlusUrl", () => {
  it("uses the numeric EVM chain id and lowercases the address", () => {
    expect(goPlusUrl("base", ADDR)).toBe(`https://gopluslabs.io/token-security/8453/${ADDR.toLowerCase()}`);
  });
  it("returns null for a non-EVM chain", () => {
    expect(goPlusUrl("qom", ADDR)).toBeNull();
  });
});

describe("honeypotUrl", () => {
  it("maps the supported chains to their honeypot.is path", () => {
    expect(honeypotUrl("eth", ADDR)).toContain("honeypot.is/ethereum?address=");
    expect(honeypotUrl("bsc", ADDR)).toContain("honeypot.is/binance-smart-chain?address=");
    expect(honeypotUrl("base", ADDR)).toContain("honeypot.is/base?address=");
  });
  it("returns null for chains honeypot.is doesn't simulate", () => {
    expect(honeypotUrl("polygon_pos", ADDR)).toBeNull();
    expect(honeypotUrl("arbitrum", ADDR)).toBeNull();
  });
});

describe("dexscreenerUrl", () => {
  it("uses the DexScreener chain slug", () => {
    expect(dexscreenerUrl("eth", ADDR)).toBe(`https://dexscreener.com/ethereum/${ADDR.toLowerCase()}`);
    expect(dexscreenerUrl("xdai", ADDR)).toContain("/gnosischain/");
  });
});

describe("blockscoutTokenUrl", () => {
  it("builds a token page on the chain's Blockscout instance (address as-is)", () => {
    expect(blockscoutTokenUrl("base", ADDR)).toBe(`https://base.blockscout.com/token/${ADDR}`);
    expect(blockscoutTokenUrl("optimism", ADDR)).toBe(`https://explorer.optimism.io/token/${ADDR}`);
  });
  it("returns null where there's no free Blockscout instance (bsc)", () => {
    expect(blockscoutTokenUrl("bsc", ADDR)).toBeNull();
  });
});

describe("coinmarketcapUrl", () => {
  it("builds a currency page from the slug", () => {
    expect(coinmarketcapUrl("usd-coin")).toBe("https://coinmarketcap.com/currencies/usd-coin/");
  });
  it("returns null without a slug", () => {
    expect(coinmarketcapUrl("")).toBeNull();
    expect(coinmarketcapUrl(null)).toBeNull();
    expect(coinmarketcapUrl(undefined)).toBeNull();
  });
});
