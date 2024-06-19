import React, {useEffect, useState} from 'react';
import Link from "next/link";
import { useRouter } from "next/router";

function Navbar() {
    const router = useRouter();
    const isActive: (pathname: string) => boolean = (pathname) =>
        router.pathname === pathname;

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
            <Link href="/">
                <a className="bold" data-active={isActive("/")}>
                    Home
                </a>
            </Link>
            &nbsp;|&nbsp;
            Tokens:
            &nbsp;
            {nav.chains.map((chain) => (
                <>
                    <Link
                        href={`/list-tokens?chain=${encodeURIComponent(chain)}`}>
                        <a>{chain}</a>
                    </Link>&nbsp;&nbsp;&nbsp;
                </>
            ))}
            &nbsp;|&nbsp;
            Pairs:
            &nbsp;
            {nav.dexs.map((dex) => (
                <>
                    <Link
                        href={`/list-pairs?chain=${encodeURIComponent(dex.c)}&dex=${encodeURIComponent(dex.d)}`}>
                        <a>{dex.c}_{dex.d}</a>
                    </Link>&nbsp;&nbsp;&nbsp;
                </>
            ))}
        </>
    );
}

export default Navbar;
