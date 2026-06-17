// lib/aliasResolve.ts
// Server-side resolution of the verified pools backing a price-test query (the public OoO simulator).
// A NORMAL query (WETH/USDC) matches pools by exact symbol; an asset-class ALIAS query (ETH/USD —
// both sides curated alias classes) expands to EVERY fungible member pool via the live alias export,
// mirroring go-ooo's S7 aggregator (the member canonical keys are the single source of truth the
// discovery manifest already ships to go-ooo, so the simulator and the oracle agree on coverage).
//
// Per-pool price ORIENTATION is done in the UI via aliasGroups.targetSideSymbol — this module only
// selects the rows. Imports prisma → server-only (getServerSideProps); never pull into a client bundle.
import { buildAliasExport } from "./aliasExport";
import { aliasPairLabel } from "./aliasGroups";
import prisma from "./prisma";
import { priceTestPairSelect } from "./publicSelect";
import { VERIFIED_STATUSES } from "./status";

import type { Prisma } from "@prisma/client";

export type PriceTestPair = Prisma.PairGetPayload<{ select: typeof priceTestPairSelect }>;

export type PriceTestResolution = {
  isAlias: boolean; // true when both sides are curated alias classes (an asset-class query)
  aliasPair: string | null; // the sorted class-pair label (e.g. "ETH.USD") when isAlias, else null
  pairs: PriceTestPair[];
};

// Resolve the verified pools backing a (base, target) price-test query.
export async function resolvePriceTestPairs(base: string, target: string): Promise<PriceTestResolution> {
  const aliasPair = aliasPairLabel(base, target);
  if (aliasPair) {
    // Expand the class pair to its member canonical keys, then select every pool that backs them.
    const { aliasPairs } = await buildAliasExport();
    const canonicalKeys = aliasPairs.find((a) => a.pair === aliasPair)?.canonicalKeys ?? [];
    const pairs = canonicalKeys.length
      ? await prisma.pair.findMany({
          where: { canonicalKey: { in: canonicalKeys }, status: { in: [...VERIFIED_STATUSES] } },
          select: priceTestPairSelect,
        })
      : [];
    return { isAlias: true, aliasPair, pairs };
  }

  const pairs = await prisma.pair.findMany({
    where: {
      OR: [{ pair: `${base}-${target}` }, { pair: `${target}-${base}` }],
      status: { in: [...VERIFIED_STATUSES] },
    },
    select: priceTestPairSelect,
  });
  return { isAlias: false, aliasPair: null, pairs };
}
