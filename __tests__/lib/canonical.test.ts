// Tests for lib/canonical.ts — the canonical-pair key (A.2).

import { describe, expect, it } from "vitest";

import { canonicalKey } from "../../lib/canonical";

describe("canonicalKey", () => {
  it("builds min:max regardless of token order", () => {
    const forward = canonicalKey({
      token0: { coingeckoCoinId: "weth" },
      token1: { coingeckoCoinId: "usd-coin" },
    });
    const reversed = canonicalKey({
      token0: { coingeckoCoinId: "usd-coin" },
      token1: { coingeckoCoinId: "weth" },
    });
    // "usd-coin" < "weth" lexically, so both orders collapse to the same key.
    expect(forward).toBe("usd-coin:weth");
    expect(reversed).toBe("usd-coin:weth");
  });

  it("returns null when token0 has no coin id", () => {
    expect(
      canonicalKey({ token0: { coingeckoCoinId: "" }, token1: { coingeckoCoinId: "weth" } }),
    ).toBeNull();
  });

  it("returns null when token1 has no coin id", () => {
    expect(
      canonicalKey({ token0: { coingeckoCoinId: "weth" }, token1: { coingeckoCoinId: "" } }),
    ).toBeNull();
  });

  it("returns null when both coin ids are missing", () => {
    expect(
      canonicalKey({ token0: { coingeckoCoinId: "" }, token1: { coingeckoCoinId: "" } }),
    ).toBeNull();
  });

  it("treats null / undefined coin ids as missing", () => {
    expect(
      canonicalKey({ token0: { coingeckoCoinId: null }, token1: { coingeckoCoinId: "weth" } }),
    ).toBeNull();
    expect(
      canonicalKey({ token0: { coingeckoCoinId: "weth" }, token1: {} }),
    ).toBeNull();
  });

  it("treats null tokens as missing", () => {
    expect(
      canonicalKey({ token0: null, token1: { coingeckoCoinId: "weth" } }),
    ).toBeNull();
    expect(canonicalKey({})).toBeNull();
  });

  it("trims and lower-cases before keying", () => {
    expect(
      canonicalKey({
        token0: { coingeckoCoinId: "  WETH " },
        token1: { coingeckoCoinId: "USD-Coin" },
      }),
    ).toBe("usd-coin:weth");
  });

  it("treats whitespace-only coin ids as missing", () => {
    expect(
      canonicalKey({ token0: { coingeckoCoinId: "   " }, token1: { coingeckoCoinId: "weth" } }),
    ).toBeNull();
  });

  it("keys a same-coin pair to id:id", () => {
    expect(
      canonicalKey({
        token0: { coingeckoCoinId: "dai" },
        token1: { coingeckoCoinId: "dai" },
      }),
    ).toBe("dai:dai");
  });
});
