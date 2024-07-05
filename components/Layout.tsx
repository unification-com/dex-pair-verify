import React, {ReactNode, useEffect, useState} from "react";
import Header from "./Header";
import {NotificationContainer} from 'react-notifications';
import {signOut, useSession} from 'next-auth/react';


import 'react-notifications/lib/notifications.css';
import Link from "next/link";
import {ExtendedSessionUser} from "../types/types";
import LogOutButton from "./LogOutButton";

type Props = {
  children: ReactNode;
};

const Layout: React.FC<Props> = (props) => {

    const { data: session, status } = useSession();

    if(status === "loading") {
        return (
            <div>
                <p>Loading...</p>
            </div>
        )
    }

    // no session - redirect to login
    if (!session) {
        return (
            <div>
                <h2>
                    <Link href="/api/auth/signin">
                        <a>Log in</a>
                    </Link>
                </h2>
            </div>
        )
    }

    // user not authorised
    if (!(session.user as ExtendedSessionUser).isAuthotised) {
        return (
            <div>
                <h2>Not Authorised</h2>
                <LogOutButton />
            </div>
        )
    }

    return (<div>
        <Header/>
        <div className="layout">{props.children}</div>
        <NotificationContainer/>
        <br/>
        <style jsx global>{`
            html {
                box-sizing: border-box;
            }

            *,
            *:before,
            *:after {
                box-sizing: inherit;
            }

            body {
                margin: 0;
                padding: 0;
                font-size: 16px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji",
                "Segoe UI Symbol";
                background: rgba(0, 0, 0, 0.05);
            }

            input,
            textarea {
                font-size: 16px;
            }

            button {
                cursor: pointer;
            }

            table {
                border: 1px solid #333;
                border-collapse: collapse;
            }

            td, th {
                border: 1px solid #333;
                padding: 5px;
            }

            .table th.up {
                background-image: url("/images/up_arrow.png");
            }

            .table th.down {
                background-image: url("/images/down_arrow.png");
            }

            .table th.default {
                background-image: url("/images/default.png");
            }

            th.up,
            th.default,
            th.down {
                cursor: pointer;
                background-repeat: no-repeat;
                background-position: center right;
            }

            .divTable {
                display: table;
                border: 1px solid #333;
            }

            .divTableRow {
                display: table-row;
            }

            .divTableHeading {
                background-color: #EEE;
                display: table-header-group;
            }

            .divTableCell, .divTableHead {
                border: 1px solid #999999;
                display: table-cell;
                padding: 3px 10px;
            }

            .divTableHeading {
                background-color: #EEE;
                display: table-header-group;
                font-weight: bold;
            }

            .divTableFoot {
                background-color: #EEE;
                display: table-footer-group;
                font-weight: bold;
            }

            .divTableBody {
                display: table-row-group;
            }

        `}</style>
        <style jsx>{`
            .layout {
                padding: 0 2rem;
            }
        `}</style>
    </div>)
};

export default Layout;
