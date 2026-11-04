// Locks the Graph-billing read selectors against a live keccak, so a typo can't silently read the wrong
// method on the Arbitrum billing contract / GRT token.
import { describe, expect, it } from "vitest";
import { utils as web3Utils } from "web3";

import { BALANCE_OF_SELECTOR, USER_BALANCES_SELECTOR } from "../../lib/graphUsage";

describe("Graph billing selectors", () => {
  it("userBalances(address) matches keccak (first 4 bytes)", () => {
    expect(USER_BALANCES_SELECTOR).toBe(web3Utils.keccak256("userBalances(address)").slice(0, 10));
  });
  it("balanceOf(address) matches keccak (first 4 bytes)", () => {
    expect(BALANCE_OF_SELECTOR).toBe(web3Utils.keccak256("balanceOf(address)").slice(0, 10));
  });
});
