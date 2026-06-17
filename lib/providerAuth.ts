// lib/providerAuth.ts
// Provider auth core (T8): the challenge-response that lets a go-ooo provider prove it controls a
// wallet registered on the OoO Router, in exchange for a short-lived export bearer. Pure crypto/message
// helpers are split out (unit-testable with injected RNG/clock); the DB-touching create/verify/lookup
// use prisma. On-chain registration is verified by an INJECTED check (isRegisteredProvider) so this
// stays testable and DRY with lib/providerRegistry.ts.

import { createHash, randomBytes } from "crypto";

import { recover } from "web3-eth-accounts";

import { oooRouterForChain } from "./oooRouters";
import prisma from "./prisma";

// Challenge lives ~5 min; an issued token ~24 h (override with EXPORT_TOKEN_TTL_SEC, aligned to go-ooo's
// export poll cadence). go-ooo re-auths on expiry / 401.
export const CHALLENGE_TTL_SEC = 300;
export const tokenTtlSec = (): number => {
  const v = Number(process.env.EXPORT_TOKEN_TTL_SEC);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 24 * 3600;
};

// --- pure helpers ---

// base64url of n random bytes; rng injectable for deterministic tests.
export const randomToken = (bytes = 32, rng: (n: number) => Buffer = randomBytes): string =>
  rng(bytes).toString("base64url");

export const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");

// The exact EIP-191 text the provider signs. Clear-text (no blind-signing) and domain/chain/Router-bound
// so a signature can't be replayed against another service or chain.
export function buildChallengeMessage(p: {
  address: string;
  chainId: number;
  router: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}): string {
  return [
    "dex-pair-verify — OoO provider authentication",
    "",
    `Address:    ${p.address}`,
    `Chain ID:   ${p.chainId}`,
    `Router:     ${p.router}`,
    `Nonce:      ${p.nonce}`,
    `Issued At:  ${new Date(p.issuedAt * 1000).toISOString()}`,
    `Expires At: ${new Date(p.expiresAt * 1000).toISOString()}`,
    "",
    "Sign to download the verified-pairs export. This does not trigger a transaction or cost gas.",
  ].join("\n");
}

// Recover the EIP-191 personal_sign signer of `message` as a lowercased address, or "" on any failure.
export function recoverSigner(message: string, signature: string): string {
  try {
    return recover(message, signature).toLowerCase();
  } catch {
    return "";
  }
}

// --- stateful (DB) operations ---

// Persist a fresh single-use challenge for a provider (the caller has already confirmed registration).
export async function createChallenge(
  address: string,
  chainId: number,
  now: number,
  rng: (n: number) => Buffer = randomBytes,
): Promise<{ message: string; nonce: string; expiresAt: number } | null> {
  const router = oooRouterForChain(chainId);
  if (!router) {
    return null;
  }
  const addr = address.toLowerCase();
  const nonce = randomToken(32, rng);
  const expiresAt = now + CHALLENGE_TTL_SEC;
  const message = buildChallengeMessage({ address: addr, chainId, router: router.router, nonce, issuedAt: now, expiresAt });
  await prisma.providerChallenge.create({ data: { address: addr, chainId, nonce, message, expiresAt, createdAt: now } });
  return { message, nonce, expiresAt };
}

// Verify a signature against the latest live (unconsumed, unexpired) challenge for (address, chainId),
// re-check on-chain registration, atomically consume the challenge, and issue a bearer token. Returns
// the raw token (shown once) + its expiry, or null on any failure. isRegistered is injected (the
// endpoint passes lib/providerRegistry's isRegisteredProvider) so this is DRY + unit-testable.
export async function verifyAndIssueToken(
  params: { address: string; chainId: number; signature: string; now: number },
  isRegistered: (address: string, chainId: number) => Promise<boolean>,
  rng: (n: number) => Buffer = randomBytes,
): Promise<{ token: string; expiresAt: number } | null> {
  const addr = params.address.toLowerCase();

  const challenge = await prisma.providerChallenge.findFirst({
    where: { address: addr, chainId: params.chainId, consumedAt: 0, expiresAt: { gt: params.now } },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) {
    return null;
  }

  if (recoverSigner(challenge.message, params.signature) !== addr) {
    return null;
  }

  // Re-check registration: the wallet may have deregistered between challenge and verify.
  if (!(await isRegistered(addr, params.chainId))) {
    return null;
  }

  // Single-use: consume only if still unconsumed (guards a concurrent double-verify race).
  const consumed = await prisma.providerChallenge.updateMany({
    where: { id: challenge.id, consumedAt: 0 },
    data: { consumedAt: params.now },
  });
  if (consumed.count !== 1) {
    return null;
  }

  const token = randomToken(32, rng);
  const expiresAt = params.now + tokenTtlSec();
  await prisma.providerToken.create({
    data: { tokenHash: sha256Hex(token), address: addr, chainId: params.chainId, issuedAt: params.now, expiresAt, lastUsedAt: 0, revokedAt: 0 },
  });
  return { token, expiresAt };
}

// Resolve a raw bearer to its live (unexpired, unrevoked) provider token, bumping lastUsedAt. Returns
// the bound wallet + chain (audit / future per-provider feed), or null when the token is unknown,
// revoked or expired. Only sha256(token) is ever compared, never the raw bearer.
export async function lookupLiveToken(rawToken: string, now: number): Promise<{ address: string; chainId: number } | null> {
  const row = await prisma.providerToken.findUnique({ where: { tokenHash: sha256Hex(rawToken) } });
  if (!row || row.revokedAt !== 0 || row.expiresAt <= now) {
    return null;
  }
  await prisma.providerToken.update({ where: { id: row.id }, data: { lastUsedAt: now } });
  return { address: row.address, chainId: row.chainId };
}
