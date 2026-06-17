// Unit tests for the pure external-tool deep-link builders.

import { describe, expect, it } from "vitest";

import { blockExplorerUrl, blockscoutTokenUrl, coinmarketcapUrl, cosmosExplorerUrl, dexscreenerUrl, explorerUrl, goPlusUrl, honeypotUrl } from "../../lib/externalLinks";

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

describe("cosmosExplorerUrl", () => {
  const NEUTRON_POOL = "neutron1nfns3ck2ykrs0fknckrzd9728cyf77devuzernhwcwrdxw7ssk2s3tjf8r";
  const ASTRO_FACTORY = "factory/neutron1ffus553eet978k024lmssw0czsxwr97mggyv85lpcsdk7vzu8fh5q/uastro";

  it("links a bech32 pool contract (Neutron Astroport) to its Mintscan account page", () => {
    expect(cosmosExplorerUrl("neutron", "address", NEUTRON_POOL)).toBe(`https://www.mintscan.io/neutron/account/${NEUTRON_POOL}`);
  });
  it("links a numeric Osmosis pool id to the Osmosis app pool page", () => {
    expect(cosmosExplorerUrl("osmosis", "address", "1932")).toBe("https://app.osmosis.zone/pool/1932");
  });
  it("links an Osmosis token denom to the Osmosis app asset page by symbol", () => {
    expect(cosmosExplorerUrl("osmosis", "token", "ibc/27394FB0...", "ATOM")).toBe("https://app.osmosis.zone/assets/ATOM");
  });
  it("links a Neutron tokenfactory denom to its issuing account on Mintscan", () => {
    expect(cosmosExplorerUrl("neutron", "token", ASTRO_FACTORY)).toBe("https://www.mintscan.io/neutron/account/neutron1ffus553eet978k024lmssw0czsxwr97mggyv85lpcsdk7vzu8fh5q");
  });
  it("returns null for an ibc/native denom with no reliable per-denom page (plain text)", () => {
    expect(cosmosExplorerUrl("neutron", "token", "ibc/C4CFF46F...")).toBeNull();
    expect(cosmosExplorerUrl("osmosis", "token", "ibc/27394FB0...")).toBeNull(); // no symbol → can't resolve
  });
  it("returns null for an unmapped (non-Cosmos) chain", () => {
    expect(cosmosExplorerUrl("eth", "token", ADDR)).toBeNull();
  });
});

describe("explorerUrl (EVM then Cosmos)", () => {
  it("uses the EVM block explorer where mapped", () => {
    expect(explorerUrl("eth", "token", ADDR)).toBe(`https://etherscan.io/token/${ADDR}`);
  });
  it("falls back to the Cosmos resolver for a Cosmos chain", () => {
    expect(explorerUrl("osmosis", "address", "1932")).toBe("https://app.osmosis.zone/pool/1932");
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
