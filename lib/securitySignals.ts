// lib/securitySignals.ts
// On-demand security scan for ONE token, for the operator "Run security scan"
// button on a borderline token under review. Force-runs GoPlus (the batch gate —
// verified-pair-only — lives in the selection query, so calling runScamCheckForToken
// directly bypasses it) PLUS the two new decision-support sources: Honeypot.is
// (covers GoPlus's blind spots) and Etherscan source-verified. Persists the new
// signals on Token.securitySignals / securityCheckedAt. Never an auto-verify gate.

import { Prisma } from "@prisma/client";

import { evmChainId } from "./chains";
import { fetchHoneypot, HoneypotResult } from "./honeypot";
import prisma from "./prisma";
import { runScamCheckForToken, ScamCheckOutcome } from "./scamCheck";
import { fetchSourceVerified, SourceVerifiedResult } from "./sourceVerified";

export type SecuritySignals = {
  honeypot: HoneypotResult;
  sourceVerified: SourceVerifiedResult;
  checkedAt: number;
};

export type SecurityScanOutcome = {
  ok: boolean;
  scam: ScamCheckOutcome | null;
  signals: SecuritySignals | null;
  error?: string;
};

export async function runSecurityScanForToken(tokenId: string, opts: { now?: number } = {}): Promise<SecurityScanOutcome> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const token = await prisma.token.findUnique({ where: { id: tokenId } });
  if (!token) {
    return { ok: false, scam: null, signals: null, error: "token not found" };
  }

  // 1. GoPlus scam — forced (the verified-pair gate is only in the batch selection).
  const scam = await runScamCheckForToken(tokenId, { now });

  // 2. Honeypot.is + Etherscan source-verified, in parallel.
  const chainId = evmChainId(token.chain);
  let honeypot: HoneypotResult;
  let sourceVerified: SourceVerifiedResult;
  if (chainId == null) {
    honeypot = { isHoneypot: null, buyTax: null, sellTax: null, risk: null, reason: null, error: "non-EVM chain" };
    sourceVerified = { verified: null, contractName: null, isProxy: null, error: "non-EVM chain" };
  } else {
    [honeypot, sourceVerified] = await Promise.all([
      fetchHoneypot(chainId, token.contractAddress),
      fetchSourceVerified(chainId, token.contractAddress, process.env.ETHERSCAN_API ?? ""),
    ]);
  }

  const signals: SecuritySignals = { honeypot, sourceVerified, checkedAt: now };
  await prisma.token.update({
    where: { id: token.id },
    data: { securitySignals: signals as unknown as Prisma.InputJsonValue, securityCheckedAt: now },
  });

  return { ok: true, scam, signals };
}
