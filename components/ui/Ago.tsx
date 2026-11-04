// components/ui/Ago.tsx
// A unix-seconds timestamp as a relative age ("3h ago"), with the full date and
// time on hover. Used by the Added / Changed columns on the list pages. The hover
// time is pinned to UTC so the server render and the browser agree.
import React from "react";

import { ageStr } from "../../lib/format";

const fullTime = (ts: number): string =>
  new Date(ts * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";

const Ago: React.FC<{ ts: number }> = ({ ts }) =>
  ts ? (
    <span title={fullTime(ts)}>{ageStr(ts)} ago</span>
  ) : (
    <span className="muted">unknown</span>
  );

export default Ago;
