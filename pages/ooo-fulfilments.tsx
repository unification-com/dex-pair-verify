import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import React from "react";

import ChainName from "../components/ChainName";
import Pagination from "../components/Pagination";
import Layout from "../components/shell/Layout";
import DataTable, { Column } from "../components/ui/DataTable";
import PageHeader from "../components/ui/PageHeader";
import SearchBox from "../components/ui/SearchBox";
import { ageStr, price18, shortHex, xfund } from "../lib/format";
import { fulfilmentFilterOptions, listFulfilments, type FulfilmentRow } from "../lib/fulfilments";
import { operatorGate } from "../lib/operatorGate";
import { cleanParam, pageParam } from "../lib/queryParams";

// A pending request older than this is treated as aged-out (go-ooo gives up around its max_job_age). Shown as
// "expired" rather than a forever-"pending"; if it ever does fulfil, the watcher updates the row anyway.
const PENDING_EXPIRY_SEC = 30 * 60;

// The "Fulfilled" cell: a relative age once fulfilled, else pending/expired by how long it's been waiting.
const fulfilledCell = (r: FulfilmentRow): React.ReactNode => {
  if (r.fulfilledAt) return `${ageStr(r.fulfilledAt)} ago`;
  if (r.requestedAt && Date.now() / 1000 - r.requestedAt > PENDING_EXPIRY_SEC) return <span className="muted">expired</span>;
  return <span className="muted">pending</span>;
};

type Props = {
  items: FulfilmentRow[];
  page: number;
  totalPages: number;
  totalCount: number;
  sort: string;
  dir: string;
  provider: string;
  chainId: string;
  pair: string;
  providers: string[];
  chains: { chainId: number; chain: string }[];
};

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const gate = await operatorGate(ctx);
  if (gate) return gate; // redirects non-operators to /

  const { query } = ctx;
  const provider = cleanParam(query?.provider);
  const chainIdStr = cleanParam(query?.chainId);
  const chainId = chainIdStr ? Number(chainIdStr) : null;
  const pair = cleanParam(query?.pair);

  const [result, options] = await Promise.all([
    listFulfilments({
      filters: { provider, chainId: chainId != null && Number.isFinite(chainId) ? chainId : null, pair },
      page: pageParam(query?.page),
      sort: cleanParam(query?.sort),
      dir: cleanParam(query?.dir),
    }),
    fulfilmentFilterOptions(),
  ]);

  return {
    props: {
      items: result.items,
      page: result.page,
      totalPages: result.totalPages,
      totalCount: result.totalCount,
      sort: result.sort,
      dir: result.dir,
      provider: provider ?? "",
      chainId: chainIdStr ?? "",
      pair: pair ?? "",
      providers: options.providers,
      chains: options.chains,
    },
  };
};

const BeaconCell: React.FC<{ row: FulfilmentRow }> = ({ row }) => {
  const b = row.beacon;
  if (!b) return <span className="muted">—</span>;
  if (b.timestampId != null) {
    return <span className="badge badge-pass badge-sm" title={b.metadata || undefined}>✓ #{b.timestampId}</span>;
  }
  return <span className="badge badge-warn badge-sm">queued</span>;
};

const OooFulfilmentsPage: React.FC<Props> = (props) => {
  const router = useRouter();

  const hrefWith = (over: Partial<{ provider: string; chainId: string; pair: string; page: number; sort: string; dir: string }>): string => {
    const qs = new URLSearchParams();
    const provider = over.provider ?? props.provider;
    const chainId = over.chainId ?? props.chainId;
    const pair = over.pair ?? props.pair;
    const sort = over.sort ?? props.sort;
    const dir = over.dir ?? props.dir;
    if (provider) qs.set("provider", provider);
    if (chainId) qs.set("chainId", chainId);
    if (pair) qs.set("pair", pair);
    if (sort) { qs.set("sort", sort); if (dir) qs.set("dir", dir); }
    if (over.page && over.page > 1) qs.set("page", String(over.page));
    const s = qs.toString();
    return s ? `/ooo-fulfilments?${s}` : "/ooo-fulfilments";
  };

  const cols: Column<FulfilmentRow>[] = [
    {
      key: "pair", label: "Pair", sortable: true, render: (r) => (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontWeight: 600 }}>{r.pair || "—"}</span>
          <span className="muted mono" style={{ fontSize: "var(--fs-xs)" }}><ChainName chain={r.chain} /> · {shortHex(r.requestId)}</span>
        </div>
      ),
    },
    { key: "result", label: "Result", num: true, render: (r) => <span className="mono" title={r.result ?? undefined}>{price18(r.result)}</span> },
    { key: "feePaid", label: "Fee", num: true, render: (r) => <span className="mono">{xfund(r.feePaid)}</span> },
    { key: "provider", label: "Provider", sortable: true, render: (r) => <span className="mono" title={r.provider || undefined}>{shortHex(r.provider)}</span> },
    { key: "fulfilledAt", label: "Fulfilled", sortable: true, render: (r) => fulfilledCell(r) },
    { key: "beacon", label: "BEACON", render: (r) => <BeaconCell row={r} /> },
  ];

  return (
    <Layout crumb="OoO fulfilments">
      <PageHeader
        title="OoO fulfilments"
        sub={`${props.totalCount} OoO price request${props.totalCount === 1 ? "" : "s"} across all networks${props.provider || props.chainId || props.pair ? " · filtered" : ""}`}
      />

      <div className="filters card card-pad">
        <SearchBox value={props.pair} placeholder="Search by pair…" onSearch={(q) => router.push(hrefWith({ pair: q, page: 1 }))} />
        <select className="input" value={props.chainId} onChange={(e) => router.push(hrefWith({ chainId: e.target.value, page: 1 }))}>
          <option value="">All networks</option>
          {props.chains.map((c) => <option key={c.chainId} value={String(c.chainId)}>{c.chain}</option>)}
        </select>
        <select className="input" value={props.provider} onChange={(e) => router.push(hrefWith({ provider: e.target.value, page: 1 }))}>
          <option value="">All providers</option>
          {props.providers.map((p) => <option key={p} value={p}>{shortHex(p)}</option>)}
        </select>
      </div>

      <DataTable
        columns={cols}
        data={props.items}
        rowKey={(r) => String(r.id)}
        serverSort={props.sort ? { key: props.sort, dir: props.dir === "asc" ? "asc" : "desc" } : null}
        onSortChange={(key, d) => router.push(hrefWith({ sort: key, dir: d, page: 1 }))}
        empty="No OoO fulfilments recorded yet."
      />

      <Pagination page={props.page} totalPages={props.totalPages} makeHref={(p) => hrefWith({ page: p })} />

      <style jsx>{`
        .filters { display: flex; gap: var(--sp-4); align-items: center; margin-bottom: var(--sp-4); flex-wrap: wrap; }
      `}</style>
    </Layout>
  );
};

export default OooFulfilmentsPage;
