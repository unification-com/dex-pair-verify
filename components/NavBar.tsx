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
                    <span key={"navbar_admin_ingest"}>
                        <Link href="/admin/ingest">
                            <a data-active={isActive("/admin/ingest")}>Ingest</a>
                        </Link>
                    </span>
                    &nbsp;&nbsp;&nbsp;
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
