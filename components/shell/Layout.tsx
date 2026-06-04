// components/shell/Layout.tsx
// Restyled app shell. Replaces the old components/Layout.tsx.
//   - Keeps the SAME auth gates (loading / no session / not authorised).
//   - REMOVE the old <style jsx global> block entirely — all global styling now
//     lives in styles/globals.css (imported once in _app.tsx).
//   - Renders the sidebar (NavBar) + a sticky topbar + the page content.
//
// `title` / `crumb` are optional page chrome; pages can also render their own
// <PageHeader/> inside children (most do).
import Link from "next/link";
import { useSession } from "next-auth/react";
import React, { ReactNode } from "react";
import { NotificationContainer } from "react-notifications";

import NavBar from "./NavBar";
import { ExtendedSessionUser } from "../../types/types";
import LogOutButton from "../LogOutButton";

type Props = { children: ReactNode; crumb?: ReactNode };

const Layout: React.FC<Props> = ({ children, crumb }) => {
  const { data: session, status } = useSession();

  if (status === "loading") return <div className="auth-screen"><p className="muted">Loading…</p></div>;
  if (!session) return (
    <div className="auth-screen">
      <div className="card card-pad col gap-5" style={{ textAlign: "center" }}>
        <h2>dex-pair-verify</h2>
        <Link href="/api/auth/signin"><a className="btn btn-primary btn-lg">Log in</a></Link>
      </div>
    </div>
  );
  if (!(session.user as ExtendedSessionUser).isAuthorised) return (
    <div className="auth-screen">
      <div className="card card-pad col gap-5" style={{ textAlign: "center" }}>
        <h2>Not authorised</h2>
        <LogOutButton />
      </div>
    </div>
  );

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
