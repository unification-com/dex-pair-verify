// components/shell/NavBar.tsx
// Restyled left sidebar. Replaces the old inline-text NavBar. Sections:
//   Main  : Home · Review queue (★, with live NeedsReview count) · Tokens
//   Pipeline : Overview + the 6 ordered passes (1·Ingest … 6·Re-validate)
//   Tools : Thresholds · OoO price-test
//   Footer: operator identity + logout
//
// The pipeline pass list is the SAME set the old NavBar linked, just grouped
// and numbered. Stale dots (passes not run in >24h) are optional — wire them to
// real freshness if you have it, else drop the `stale` flags.
import Link from "next/link";
import { useRouter } from "next/router";
import { signOut, useSession } from "next-auth/react";
import React from "react";

import Icon from "../ui/Icon";

const PASSES = [
  { step: 1, id: "ingest", name: "Ingest", href: "/admin/ingest" },
  { step: 2, id: "identitycheck", name: "Identity", href: "/admin/identitycheck" },
  { step: 3, id: "canonicalcheck", name: "Canonical", href: "/admin/canonicalcheck" },
  { step: 4, id: "factorycheck", name: "Factory", href: "/admin/factorycheck" },
  { step: 5, id: "scancheck", name: "Scam", href: "/admin/scancheck" },
  { step: 6, id: "revalidate", name: "Re-validate", href: "/admin/revalidate" },
];

const NavBar: React.FC<{ needsReviewCount?: number }> = ({ needsReviewCount }) => {
  const router = useRouter();
  const { data: session } = useSession();
  const active = (p: string) => router.asPath === p || router.asPath.startsWith(p + "?");

  const Item = ({ href, icon, label, pill, active: a, star }: {
    href: string; icon?: string; label: string; pill?: number | null; active?: boolean; star?: boolean;
  }) => (
    <Link href={href}><a className={`sb-link${a ? " active" : ""}`}>
      {icon ? <Icon name={icon} /> : null}
      <span className="lbl">{label}{star ? <span style={{ color: "var(--accent)", marginLeft: 4 }}>★</span> : null}</span>
      {pill != null ? <span className="pill">{pill}</span> : null}
    </a></Link>
  );

  return (
    <aside className="sidebar">
      <div className="sb-brand">
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny static brand tile; next/image is overkill */}
        <img src="/unification_icon_128.png" alt="Unification" style={{ width: 28, height: 28, borderRadius: 7, flex: "none", display: "block" }} />
        <div className="col"><span className="name">Pair Verify</span><span className="env">unification · oracle</span></div>
      </div>

      <nav className="sb-nav">
        <Item href="/admin" icon="home" label="Dashboard" active={router.asPath === "/admin"} />
        <Item href="/admin/list-pairs?status=NeedsReview" icon="queue" label="Review queue" star pill={needsReviewCount ?? null} active={active("/admin/list-pairs")} />
        <Item href="/admin/list-tokens" icon="token" label="Tokens" active={active("/admin/list-tokens")} />

        {session && <>
          <div className="sb-group-label">Pipeline</div>
          {PASSES.map((p) => (
            <Link key={p.id} href={p.href}><a className={`sb-link${active(p.href) ? " active" : ""}`}>
              <span className="sb-step-no">{p.step}</span><span className="lbl">{p.name}</span>
            </a></Link>
          ))}

          <div className="sb-group-label">Tools</div>
          <Item href="/admin/thresholds" icon="filter" label="Thresholds" active={active("/admin/thresholds")} />
          <Item href="/admin/p/test" icon="price" label="OoO price-test" active={active("/admin/p/test")} />
          <Item href="/admin/help" icon="help" label="Scoring guide" active={active("/admin/help")} />
        </>}
      </nav>

      {session && (
        <div className="sb-foot">
          <span className="sb-avatar">{(session.user?.name || "OP").slice(0, 2).toUpperCase()}</span>
          <div className="col grow" style={{ minWidth: 0 }}>
            <span style={{ fontWeight: 500, fontSize: "var(--fs-sm)" }} className="truncate">{session.user?.name || "operator"}</span>
            <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>authorised</span>
          </div>
          <button onClick={() => signOut()} className="btn btn-ghost btn-sm" title="Log out"><Icon name="logout" size={15} />Log out</button>
        </div>
      )}
    </aside>
  );
};

export default NavBar;
