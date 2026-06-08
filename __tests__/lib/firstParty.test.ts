// Unit tests for the first-party (Unification) token allowlist.

import { describe, expect, it } from "vitest";

import { FIRST_PARTY_TOKENS, ingestableFirstParty, isFirstParty } from "../../lib/firstParty";

const FUND_ETH = "0xe9B076B476D8865cDF79D1Cf7DF420EE397a7f75";

describe("isFirstParty", () => {
  it("matches a first-party token case-insensitively", () => {
    expect(isFirstParty("eth", FUND_ETH)).toBe(true);
    expect(isFirstParty("eth", FUND_ETH.toLowerCase())).toBe(true);
    expect(isFirstParty("eth", FUND_ETH.toUpperCase().replace("0X", "0x"))).toBe(true);
    expect(isFirstParty("polygon_pos", "0x77a3840f78e4685afaf9c416b36e6eae6122567b")).toBe(true); // xFUND polygon
  });

  it("does not match a non-first-party token, or a first-party address on the wrong chain", () => {
    expect(isFirstParty("eth", "0x0000000000000000000000000000000000000001")).toBe(false);
    expect(isFirstParty("polygon_pos", FUND_ETH)).toBe(false); // FUND's eth address ≠ polygon
  });
});

describe("ingestableFirstParty", () => {
  it("includes eth + polygon tokens and excludes dormant Shibarium", () => {
    const chains = new Set(ingestableFirstParty().map((t) => t.chain));
    expect(chains.has("eth")).toBe(true);
    expect(chains.has("polygon_pos")).toBe(true);
    expect(chains.has("shibarium")).toBe(false); // not an EVM chain we map → dormant
  });

  it("keeps the dormant Shibarium entries in the full list (for when it's onboarded)", () => {
    expect(FIRST_PARTY_TOKENS.some((t) => t.chain === "shibarium")).toBe(true);
  });
});
