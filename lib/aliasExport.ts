// lib/aliasExport.ts
// Derives the alias payload (T13) embedded in the v3 discovery manifest. Two parts:
//   - aliasGroups: the curated asset classes (symbol → member cg ids) from lib/aliasGroups.ts. The
//     trust boundary; go-ooo consumes it verbatim to resolve which cg ids belong to a class.
//   - aliasPairs:  the ACTIVE cross-class alias pairs (e.g. "ETH.USD") that have ≥1 backing VERIFIED
//     pair, each with the member canonical keys that back it. go-ooo's S7 aggregator expands an alias
//     query to those canonical keys, selects the matching dex_pairs, and robust-aggregates them.
// aliasPairs is derived from the live verified set, so it lists only classes the operator actually has
// coverage for — and it saves go-ooo recomputing the cg-id cross-product.
import { ALIAS_GROUPS, aliasPairForCanonicalKey } from "./aliasGroups";
import prisma from "./prisma";
import { VERIFIED_STATUSES } from "./status";

export type ExportAliasGroup = { symbol: string; cgIds: string[] };
export type ExportAliasPair = { pair: string; canonicalKeys: string[] };
export type AliasExport = { aliasGroups: ExportAliasGroup[]; aliasPairs: ExportAliasPair[] };

export async function buildAliasExport(): Promise<AliasExport> {
  // Distinct canonical keys across the verified set — one row per logical pair, so the alias-pair
  // membership is computed once regardless of how many chains/DEXs back each canonical key.
  const rows = await prisma.pair.findMany({
    where: { status: { in: [...VERIFIED_STATUSES] }, canonicalKey: { not: null } },
    select: { canonicalKey: true },
    distinct: ["canonicalKey"],
  });

  const byAliasPair = new Map<string, Set<string>>();
  for (const r of rows) {
    const ck = r.canonicalKey;
    if (!ck) {
      continue;
    }
    const ap = aliasPairForCanonicalKey(ck);
    if (!ap) {
      continue;
    }
    let set = byAliasPair.get(ap);
    if (!set) {
      set = new Set<string>();
      byAliasPair.set(ap, set);
    }
    set.add(ck);
  }

  const aliasGroups: ExportAliasGroup[] = Object.entries(ALIAS_GROUPS).map(([symbol, cgIds]) => ({ symbol, cgIds }));
  const aliasPairs: ExportAliasPair[] = Array.from(byAliasPair.entries())
    .map(([pair, cks]) => ({ pair, canonicalKeys: Array.from(cks).sort() }))
    .sort((a, b) => a.pair.localeCompare(b.pair));

  return { aliasGroups, aliasPairs };
}
