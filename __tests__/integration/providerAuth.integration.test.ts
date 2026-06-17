// Integration tests for the provider-auth DB flow (T8): createChallenge -> sign -> verifyAndIssueToken
// -> lookupLiveToken -> authoriseExport, against the test DB. The on-chain registration check is
// injected (yes/no); the signing + EIP-191 recovery are real (web3-eth-accounts).

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as accounts from "web3-eth-accounts";


import { resetDb, testPrisma } from "./helpers";
import { authoriseExport } from "../../lib/exportAuth";
import { createChallenge, lookupLiveToken, verifyAndIssueToken } from "../../lib/providerAuth";

import type { NextApiRequest } from "next";

const NOW = 1_700_000_000;
const CHAIN = 11155111; // sepolia — an OoO Router chain
const TOKEN_TTL = 24 * 3600;
const registered = async () => true;
const notRegistered = async () => false;

const reqWith = (bearer?: string): NextApiRequest =>
  ({ headers: bearer ? { authorization: `Bearer ${bearer}` } : {} } as NextApiRequest);

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("provider auth DB flow (T8)", () => {
  it("challenge → sign → verify → token → authorise", async () => {
    const acct = accounts.create();
    const addr = acct.address;

    const ch = await createChallenge(addr, CHAIN, NOW);
    expect(ch).not.toBeNull();

    const stored = await testPrisma.providerChallenge.findFirst({ where: { address: addr.toLowerCase() } });
    expect(stored?.message).toBe(ch!.message);

    const { signature } = acct.sign(ch!.message);
    const issued = await verifyAndIssueToken({ address: addr, chainId: CHAIN, signature, now: NOW + 10 }, registered);
    expect(issued).not.toBeNull();

    // The challenge is consumed (single-use).
    const consumed = await testPrisma.providerChallenge.findUnique({ where: { nonce: stored!.nonce } });
    expect(consumed?.consumedAt).toBeGreaterThan(0);

    // The token resolves to the bound wallet + chain.
    expect(await lookupLiveToken(issued!.token, NOW + 20)).toEqual({ address: addr.toLowerCase(), chainId: CHAIN });

    // authoriseExport accepts it (via the wallet-token path).
    const principal = await authoriseExport(reqWith(issued!.token), NOW + 30);
    expect(principal?.via).toBe("token");
    expect(principal?.address).toBe(addr.toLowerCase());
  });

  it("rejects a signature from the wrong key", async () => {
    const acct = accounts.create();
    const ch = await createChallenge(acct.address, CHAIN, NOW);
    const impostor = accounts.create();
    const { signature } = impostor.sign(ch!.message); // signed by a different wallet
    expect(await verifyAndIssueToken({ address: acct.address, chainId: CHAIN, signature, now: NOW + 10 }, registered)).toBeNull();
  });

  it("rejects when the wallet is no longer a registered provider", async () => {
    const acct = accounts.create();
    const ch = await createChallenge(acct.address, CHAIN, NOW);
    const { signature } = acct.sign(ch!.message);
    expect(await verifyAndIssueToken({ address: acct.address, chainId: CHAIN, signature, now: NOW + 10 }, notRegistered)).toBeNull();
  });

  it("is single-use: a second verify on the same challenge fails", async () => {
    const acct = accounts.create();
    const ch = await createChallenge(acct.address, CHAIN, NOW);
    const { signature } = acct.sign(ch!.message);
    expect(await verifyAndIssueToken({ address: acct.address, chainId: CHAIN, signature, now: NOW + 10 }, registered)).not.toBeNull();
    expect(await verifyAndIssueToken({ address: acct.address, chainId: CHAIN, signature, now: NOW + 20 }, registered)).toBeNull();
  });

  it("rejects an expired challenge", async () => {
    const acct = accounts.create();
    const ch = await createChallenge(acct.address, CHAIN, NOW);
    const { signature } = acct.sign(ch!.message);
    expect(await verifyAndIssueToken({ address: acct.address, chainId: CHAIN, signature, now: NOW + 301 }, registered)).toBeNull();
  });

  it("lookupLiveToken rejects expired + revoked tokens", async () => {
    const acct = accounts.create();
    const ch = await createChallenge(acct.address, CHAIN, NOW);
    const { signature } = acct.sign(ch!.message);
    const issued = await verifyAndIssueToken({ address: acct.address, chainId: CHAIN, signature, now: NOW }, registered);

    // Expired.
    expect(await lookupLiveToken(issued!.token, NOW + TOKEN_TTL + 1)).toBeNull();
    // Revoked (operator break-glass).
    await testPrisma.providerToken.updateMany({ where: { address: acct.address.toLowerCase() }, data: { revokedAt: NOW + 5 } });
    expect(await lookupLiveToken(issued!.token, NOW + 10)).toBeNull();
  });
});
