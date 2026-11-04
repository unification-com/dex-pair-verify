// components/ui/PageHeader.tsx
// Consistent page title block: big title, optional subtitle, optional right-
// aligned actions, optional inline badge. Use at the top of every page's
// content (inside <Layout>).
import React, { ReactNode } from "react";

const PageHeader: React.FC<{ title: ReactNode; sub?: ReactNode; actions?: ReactNode; badge?: ReactNode }> = ({ title, sub, actions, badge }) => (
  <div className="page-head">
    <div>
      <div className="row gap-4 items-baseline"><h1>{title}</h1>{badge}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
    {actions ? <div className="actions">{actions}</div> : null}
  </div>
);

export default PageHeader;
