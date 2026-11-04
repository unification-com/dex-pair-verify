// Tests for lib/sqs.ts fetchSqsPrices: it reads the single USD quote SQS returns per denom, whichever
// USD denom that is (SQS moved from Noble USDC to alloyed USDC, which a fixed quote denom missed).
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchSqsPrices } from "../../lib/sqs";

const ALLOYED_USDC = "factory/osmo147h5x9pcj7lm0cttlaefx6sqq5vdfnmwfcqxkmjd7exqm9gc7grqhr75m0/alloyed/allUSDC";

afterEach(() => vi.unstubAllGlobals());

describe("fetchSqsPrices", () => {
  it("reads each denom's quote in whatever USD denom SQS prices in", async () => {
    const body = { uosmo: { [ALLOYED_USDC]: "0.0473" }, "ibc/ATOM": { [ALLOYED_USDC]: "1.97" }, "ibc/BAD": { [ALLOYED_USDC]: "n/a" } };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => body }));
    vi.stubGlobal("fetch", fetchMock);

    const prices = await fetchSqsPrices("https://sqs.test/", ["uosmo", "ibc/ATOM", "ibc/BAD"]);

    expect(fetchMock).toHaveBeenCalledWith("https://sqs.test/tokens/prices?base=uosmo,ibc/ATOM,ibc/BAD", expect.anything());
    expect(Object.fromEntries(prices)).toEqual({ uosmo: 0.0473, "ibc/ATOM": 1.97 });
  });

  it("returns no prices when SQS is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect((await fetchSqsPrices("https://sqs.test", ["uosmo"])).size).toBe(0);
  });
});
