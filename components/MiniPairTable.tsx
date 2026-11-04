import { useRouter } from "next/router";
import React from "react";

import ChainName from "./ChainName";
import DexName from "./DexName";
import { usd, num } from "../lib/format";
import { TokenPairStatus } from "../types/types";
import DataTable, { Column } from "./ui/DataTable";
import StatusBadge from "./ui/StatusBadge";

// A compact pair row for the "also traded on other DEXs" / "possible duplicates"
// tables on the pair detail page. Shared by the operator and public views; rows
// click through to the pair detail.
export type MiniPair = {
  id: string;
  chain: string;
  dex: string;
  pair: string;
  reserveUsd: number;
  txCount: number;
  status: TokenPairStatus;
};

const cols: Column<MiniPair>[] = [
  { key: "chain", label: "Chain", render: (r) => <ChainName chain={r.chain} /> },
  { key: "dex", label: "DEX", render: (r) => <DexName dex={r.dex} /> },
  { key: "pair", label: "Pair", sortable: true },
  { key: "reserveUsd", label: "Reserve", num: true, sortable: true, render: (r) => usd(r.reserveUsd) },
  { key: "txCount", label: "Tx", num: true, sortable: true, render: (r) => num(r.txCount) },
  { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} size="sm" /> },
];

const MiniPairTable: React.FC<{ pairs: MiniPair[]; sortInit?: { key: string; dir: "asc" | "desc" } }> = ({ pairs, sortInit }) => {
  const router = useRouter();
  return <DataTable columns={cols} data={pairs} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/p/${r.id}`)} sortInit={sortInit} />;
};

export default MiniPairTable;
