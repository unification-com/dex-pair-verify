import Link from "next/link";
import { useRouter } from "next/router";
import { useSession } from 'next-auth/react';
import React, {useEffect, useState} from 'react';

import LogOutButton from "./LogOutButton";

function Navbar() {
    const router = useRouter();
    const isActive: (pathname: string) => boolean = (pathname) =>
        router.pathname === pathname;

    const { data: session } = useSession();

    const [nav, setNav] = useState({dexs: [], chains: []});

    useEffect(() => {
        fetch('/api/nav')
            .then(response => response.json())
            .then(data => {
                setNav(data)
            })
            .catch(error => {
                console.error('Error:', error);
            });
    }, []);

    return (
        <>
            <span key={"navbar_home"}>
                <Link href="/">
                <a className="bold" data-active={isActive("/")}>
                    Home
                </a>
                </Link>
            </span>
            &nbsp;|&nbsp;
            Tokens:
            &nbsp;
            {nav.chains.map((chain) => (
                <span key={`navbar_token_${chain}`}>
                    <Link
                        href={`/list-tokens?chain=${encodeURIComponent(chain)}`}>
                        <a>{chain}</a>
                    </Link>&nbsp;&nbsp;&nbsp;
                </span>
            ))}
            &nbsp;|&nbsp;
            Pairs:
            &nbsp;
            {nav.dexs.map((dex) => (
                <span key={`navbar_token_${dex.c}_${dex.d}`}>
                    <Link
                        href={`/list-pairs?chain=${encodeURIComponent(dex.c)}&dex=${encodeURIComponent(dex.d)}`}>
                        <a>{dex.c}_{dex.d}</a>
                    </Link>&nbsp;&nbsp;&nbsp;
                </span>
            ))}

            {session && (
                <>
                    &nbsp;|&nbsp;
                    {/* Admin dashboard (run-order guidance) + the pipeline tools in the
                        order they should be run: ingest → identity → canonical →
                        factory → scam, then tuning/maintenance. */}
                    <span key={"navbar_admin"}>
                        <Link href="/admin">
                            <a className="bold" data-active={isActive("/admin")}>Admin</a>
                        </Link>
                    </span>
                    &nbsp;&nbsp;
                    <span key={"navbar_admin_ingest"}>
                        <Link href="/admin/ingest">
                            <a data-active={isActive("/admin/ingest")}>1·Ingest</a>
                        </Link>
                    </span>
                    &nbsp;
                    <span key={"navbar_admin_identitycheck"}>
                        <Link href="/admin/identitycheck">
                            <a data-active={isActive("/admin/identitycheck")}>2·Identity</a>
                        </Link>
                    </span>
                    &nbsp;
                    <span key={"navbar_admin_canonicalcheck"}>
                        <Link href="/admin/canonicalcheck">
                            <a data-active={isActive("/admin/canonicalcheck")}>3·Canonical</a>
                        </Link>
                    </span>
                    &nbsp;
                    <span key={"navbar_admin_factorycheck"}>
                        <Link href="/admin/factorycheck">
                            <a data-active={isActive("/admin/factorycheck")}>4·Factory</a>
                        </Link>
                    </span>
                    &nbsp;
                    <span key={"navbar_admin_scancheck"}>
                        <Link href="/admin/scancheck">
                            <a data-active={isActive("/admin/scancheck")}>5·Scam</a>
                        </Link>
                    </span>
                    &nbsp;|&nbsp;
                    <span key={"navbar_admin_thresholds"}>
                        <Link href="/admin/thresholds">
                            <a data-active={isActive("/admin/thresholds")}>Thresholds</a>
                        </Link>
                    </span>
                    &nbsp;&nbsp;
                    <span key={"navbar_admin_revalidate"}>
                        <Link href="/admin/revalidate">
                            <a data-active={isActive("/admin/revalidate")}>Re-validate</a>
                        </Link>
                    </span>
                    &nbsp;
                </>
            )}

            {session && <LogOutButton />}
        </>
    );
}

export default Navbar;
