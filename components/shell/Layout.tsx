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
import React, { ReactNode } from "react";
import { NotificationContainer } from "react-notifications";

import NavBar from "./NavBar";

type Props = { children: ReactNode; crumb?: ReactNode };

const Layout: React.FC<Props> = ({ children, crumb }) => {
  const { status } = useSession();

  if (status === "loading") return <div className="auth-screen"><p className="muted">Loading…</p></div>;

  return (
    <div className="app">
      <NavBar />
      <div className="main">
        <header className="topbar">
          <div className="crumb">{crumb}</div>
          <span className="grow" />
        </header>
        {children}
      </div>
      <NotificationContainer />
      <style jsx>{`
        .auth-screen { min-height: 100vh; display: grid; place-items: center; }
      `}</style>
    </div>
  );
};

export default Layout;
