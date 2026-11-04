// lib/statusWrite.ts
// Multi-row status writes. statusChangedAt records a row's last real status
// transition (the /latest "status changed" view), so a write that sets the status
// a row already has must leave it alone. An updateMany can't compare per row, so
// the write is split in two: rows already at the target status get only the other
// fields, the rest are stamped. Same-status rows go first so the second write
// can't re-match the rows it just moved. Single-row writes that already know the
// current status use statusData (lib/status.ts) instead.

import { Prisma } from "@prisma/client";

import prisma from "./prisma";
import { TokenPairStatus } from "../types/types";

type BatchUpdater = {
  updateMany(args: { where: object; data: object }): Prisma.PrismaPromise<Prisma.BatchPayload>;
};

// Sets `status` (plus `extra`) on every matching row; returns the number of rows written.
export function setStatusWhere(model: "pair", where: Prisma.PairWhereInput, status: TokenPairStatus, extra: Prisma.PairUpdateManyMutationInput, now: number): Promise<number>;
export function setStatusWhere(model: "token", where: Prisma.TokenWhereInput, status: TokenPairStatus, extra: Prisma.TokenUpdateManyMutationInput, now: number): Promise<number>;
export async function setStatusWhere(model: "pair" | "token", where: object, status: TokenPairStatus, extra: object, now: number): Promise<number> {
  const rows = prisma[model] as unknown as BatchUpdater;
  const [same, changed] = await prisma.$transaction([
    rows.updateMany({ where: { AND: [where, { status }] }, data: { ...extra, status } }),
    rows.updateMany({ where: { AND: [where, { status: { not: status } }] }, data: { ...extra, status, statusChangedAt: now } }),
  ]);
  return same.count + changed.count;
}
