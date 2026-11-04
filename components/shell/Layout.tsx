// components/shell/Layout.tsx
// The app shell — public read-only by default, with the operator surface layered on.
//   - No hard auth gate any more: the shell renders for everyone. The NavBar shows
//     public links to all and the operator group + Log out only to allow-listed
//     operators; anonymous visitors get a Log in button. Pages render a public
//     read-only view vs the full operator view off the `isOperator` prop their
//     getServerSideProps resolves (so operator data never reaches the public).
//   - Operator-only pages (pipeline passes, thresholds, OoO price-test, scoring
//     guide) SSR-guard via lib/operatorGate → redirect the public to `/`.
//   - All global styling lives in styles/globals.css (imported once in _app.tsx).
//
// `crumb` is optional page chrome; pages also render their own <PageHeader/>.
import { useSession } from "next-auth/react";
import React, { ReactNode, useEffect, useState } from "react";
import { NotificationContainer } from "react-notifications";

import NavBar from "./NavBar";
import Icon from "../ui/Icon";

type Props = { children: ReactNode; crumb?: ReactNode };

const Layout: React.FC<Props> = ({ children, crumb }) => {
  const { status } = useSession();
  const [navOpen, setNavOpen] = useState(false);

  // Close the mobile nav drawer on Escape (backdrop tap + link tap close it too).
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNavOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  if (status === "loading") return <div className="auth-screen"><p className="muted">Loading…</p></div>;

  return (
    <div className={`app${navOpen ? " nav-open" : ""}`}>
      <NavBar onNavigate={() => setNavOpen(false)} />
      {navOpen ? <button type="button" className="nav-backdrop" aria-label="Close navigation" onClick={() => setNavOpen(false)} /> : null}
      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="nav-toggle"
            aria-label="Open navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen((o) => !o)}
          >
            <Icon name="menu" size={20} />
          </button>
          <div className="crumb">{crumb}</div>
          <span className="grow" />
        </header>
        <div className="content">{children}</div>
      </div>
      <NotificationContainer />
      <style jsx>{`
        .auth-screen { min-height: 100vh; display: grid; place-items: center; }
      `}</style>
    </div>
  );
};

export default Layout;
