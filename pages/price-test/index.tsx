import { useRouter } from "next/router";
import React, { FormEvent, useState } from "react";

import Layout from "../../components/shell/Layout";
import Icon from "../../components/ui/Icon";
import PageHeader from "../../components/ui/PageHeader";

// Entry point for the OoO price-test (the sidebar links here). Enter a symbol
// pair → the per-pool price simulation. You can also reach this from any
// verified pair's "Price test" action.
const PriceTestIndex: React.FC = () => {
  const router = useRouter();
  const [base, setBase] = useState("WETH");
  const [target, setTarget] = useState("USDC");

  const go = (e: FormEvent) => {
    e.preventDefault();
    const b = base.trim().toUpperCase();
    const t = target.trim().toUpperCase();
    if (b && t) router.push(`/price-test/${encodeURIComponent(b)}/${encodeURIComponent(t)}`);
  };

  return (
    <Layout crumb="OoO price-test">
      <PageHeader title="OoO price-test" sub="Simulate the oracle price for a verified pair across every backing pool." />
      <form onSubmit={go} className="card card-pad" style={{ display: "flex", gap: "var(--sp-4)", alignItems: "flex-end", flexWrap: "wrap", maxWidth: 520 }}>
        <label className="col gap-2">
          <span className="eyebrow">Base</span>
          <input className="input" value={base} onChange={(e) => setBase(e.target.value)} placeholder="WETH" />
        </label>
        <span style={{ paddingBottom: 8, color: "var(--text-2)" }}>→</span>
        <label className="col gap-2">
          <span className="eyebrow">Target</span>
          <input className="input" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="USDC" />
        </label>
        <button type="submit" className="btn btn-primary"><Icon name="price" size={14} />Run test</button>
      </form>
    </Layout>
  );
};

export default PriceTestIndex;
