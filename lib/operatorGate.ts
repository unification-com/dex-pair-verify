// lib/operatorGate.ts
// Server-side operator gate for getServerSideProps. Operator-only pages (pipeline
// passes, thresholds, OoO price-test, scoring guide) redirect anonymous / non-allow-
// listed visitors to the public home. Public-capable pages call `isOperatorCtx` to
// branch their data + render between the public read-only view and the full
// operator view. The allow-list itself is enforced in the next-auth callbacks
// (lib/adminAllow) — this just reads the resulting isAuthorised flag.

import { getServerSession } from "next-auth";

import { authOptions } from "../pages/api/auth/[...nextauth]";
import { ExtendedSessionUser } from "../types/types";

import type { GetServerSidePropsContext, GetServerSidePropsResult } from "next";

// True when the request is an authenticated, allow-listed operator.
export async function isOperatorCtx(ctx: GetServerSidePropsContext): Promise<boolean> {
  const session = await getServerSession(ctx.req, ctx.res, authOptions);
  return !!(session?.user as ExtendedSessionUser | undefined)?.isAuthorised;
}

// Guard for operator-only pages: returns a redirect to `/` for non-operators, or
// null when the operator may proceed (the caller continues its own data fetch).
export async function operatorGate(
  ctx: GetServerSidePropsContext,
): Promise<{ redirect: { destination: string; permanent: boolean } } | null> {
  return (await isOperatorCtx(ctx)) ? null : { redirect: { destination: "/", permanent: false } };
}

// A ready-made getServerSideProps for operator-only pages that fetch nothing
// server-side (the pipeline-pass pages, OoO price-test entry).
export const operatorOnlyGSSP = async (
  ctx: GetServerSidePropsContext,
): Promise<GetServerSidePropsResult<Record<string, never>>> => {
  const gate = await operatorGate(ctx);
  return gate ?? { props: {} };
};
