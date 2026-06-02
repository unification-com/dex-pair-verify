// Shared integration-test helpers: a single PrismaClient pointed at the
// test DB + a truncate-between-tests reset.
//
// We instantiate our own client here (rather than importing import/db.js's
// internal one) so the reset path is independent of the code under test.

import { PrismaClient } from "@prisma/client";

export const testPrisma = new PrismaClient();

// Tables in FK-safe truncation order (children first). CASCADE handles the
// rest, but listing them keeps the intent explicit.
const TABLES = [
  "DuplicatePairs",
  "DuplicateTokenSymbols",
  "Pair",
  "PairStaging",
  "Token",
  "Threshold",
  "CanonicalAddress",
];

export async function resetDb(): Promise<void> {
  const list = TABLES.map((t) => `"public"."${t}"`).join(", ");
  await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
}
