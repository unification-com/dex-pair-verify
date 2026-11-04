// Unit tests for the pure provider-auth helpers (T8): message build, token/hash, EIP-191 recovery.
// The DB-touching create/verify/lookup are covered by the integration test.

import { describe, expect, it } from "vitest";
import * as accounts from "web3-eth-accounts";


import { buildChallengeMessage, randomToken, recoverSigner, sha256Hex } from "../../lib/providerAuth";

describe("buildChallengeMessage", () => {
  it("binds address/chain/router/nonce and is deterministic", () => {
    const args = { address: "0xabc", chainId: 1, router: "0xrouter", nonce: "NONCE-1", issuedAt: 0, expiresAt: 300 };
    const m = buildChallengeMessage(args);
    expect(m).toBe(buildChallengeMessage(args)); // deterministic
    expect(m).toContain("dex-pair-verify — OoO provider authentication");
    expect(m).toContain("Address:    0xabc");
    expect(m).toContain("Chain ID:   1");
    expect(m).toContain("Router:     0xrouter");
    expect(m).toContain("Nonce:      NONCE-1");
    expect(m).toContain("does not trigger a transaction");
  });
});

describe("randomToken / sha256Hex", () => {
  it("randomToken is base64url of the (injected) random bytes", () => {
    const bytes = Buffer.from([0xff, 0x00, 0xab, 0xcd]);
    expect(randomToken(4, () => bytes)).toBe(bytes.toString("base64url"));
  });

  it("sha256Hex is a stable 64-hex digest", () => {
    expect(sha256Hex("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
    expect(sha256Hex("abc")).not.toBe(sha256Hex("abd"));
  });
});

describe("recoverSigner", () => {
  it("recovers the EIP-191 personal_sign signer (lowercased)", () => {
    const acct = accounts.create();
    const msg = buildChallengeMessage({ address: acct.address.toLowerCase(), chainId: 1, router: "0xr", nonce: "n", issuedAt: 0, expiresAt: 300 });
    const { signature } = acct.sign(msg);
    expect(recoverSigner(msg, signature)).toBe(acct.address.toLowerCase());
  });

  it("returns '' on a garbage signature", () => {
    expect(recoverSigner("msg", "0xdeadbeef")).toBe("");
  });
});
