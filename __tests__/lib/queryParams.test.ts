// Tests for lib/queryParams.ts: the list pages' query-string parsing and hrefs.

import { describe, expect, it } from "vitest";

import { listHref } from "../../lib/queryParams";

describe("listHref", () => {
  it("is the bare path when nothing is set", () => {
    expect(listHref("/pairs", {})).toBe("/pairs");
    expect(listHref("/pairs", { chain: "", dex: null, q: undefined }, 1)).toBe("/pairs");
  });

  it("keeps the non-empty filters in the given order", () => {
    expect(listHref("/pairs", { status: "NeedsReview", chain: "eth", dex: "", q: "weth" })).toBe(
      "/pairs?status=NeedsReview&chain=eth&q=weth",
    );
  });

  it("adds the page only past the first", () => {
    expect(listHref("/tokens", { chain: "eth" }, 1)).toBe("/tokens?chain=eth");
    expect(listHref("/tokens", { chain: "eth" }, 3)).toBe("/tokens?chain=eth&page=3");
    expect(listHref("/tokens", {}, 2)).toBe("/tokens?page=2");
  });

  it("encodes values", () => {
    expect(listHref("/pairs", { q: "a b&c" })).toBe("/pairs?q=a+b%26c");
  });
});
