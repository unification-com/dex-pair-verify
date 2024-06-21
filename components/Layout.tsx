import React, { ReactNode } from "react";
import Header from "./Header";
import {NotificationContainer} from 'react-notifications';


import 'react-notifications/lib/notifications.css';

type Props = {
  children: ReactNode;
};

const Layout: React.FC<Props> = (props) => (
  <div>
    <Header />
    <div className="layout">{props.children}</div>
    <NotificationContainer/>
      <br />
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
      
    `}</style>
    <style jsx>{`
      .layout {
        padding: 0 2rem;
      }
    `}</style>
  </div>
);

export default Layout;
