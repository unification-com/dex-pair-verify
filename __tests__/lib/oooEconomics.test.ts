// Locks the getWithdrawableTokens(address) call selector against a live keccak, so a typo can't silently
// read the wrong Router method on the economics dashboard.
import { describe, expect, it } from "vitest";
import { utils as web3Utils } from "web3";

import { WITHDRAWABLE_SELECTOR } from "../../lib/oooEconomics";

describe("getWithdrawableTokens selector", () => {
  it("matches keccak256 of the signature (first 4 bytes)", () => {
    expect(WITHDRAWABLE_SELECTOR).toBe(web3Utils.keccak256("getWithdrawableTokens(address)").slice(0, 10));
  });
});
