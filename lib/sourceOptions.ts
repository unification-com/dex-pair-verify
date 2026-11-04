// lib/sourceOptions.ts
// The chain + DEX filter options for a list page: every (chain, dex) that has a
// pair in scope. Rendered by components/SourceFilter.tsx.

import { Prisma } from "@prisma/client";

import prisma from "./prisma";

export type SourceOption = { chain: string; dex: string };

export async function sourceOptions(where: Prisma.PairWhereInput = {}): Promise<{ chains: string[]; sources: SourceOption[] }> {
  const groups = await prisma.pair.groupBy({ by: ["chain", "dex"], where });
  return {
    chains: Array.from(new Set(groups.map((g) => g.chain))).sort(),
    sources: groups.map((g) => ({ chain: g.chain, dex: g.dex })),
  };
}
