// Shared prev/next pager for the server-paginated list pages.
// `makeHref` builds the URL for a given page, preserving the page's other
// query params (chain / dex / status).

import Link from "next/link";
import React from "react";

const Pagination: React.FC<{
  page: number;
  totalPages: number;
  makeHref: (p: number) => string;
}> = ({ page, totalPages, makeHref }) => {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="pagination">
      {page > 1 ? (
        <Link href={makeHref(page - 1)}>
          <a>&larr; Prev</a>
        </Link>
      ) : (
        <span className="disabled">&larr; Prev</span>
      )}
      <span className="page-indicator">
        &nbsp;Page {page} of {totalPages}&nbsp;
      </span>
      {page < totalPages ? (
        <Link href={makeHref(page + 1)}>
          <a>Next &rarr;</a>
        </Link>
      ) : (
        <span className="disabled">Next &rarr;</span>
      )}
      <style jsx>{`
        .pagination {
          margin: 1rem 0;
        }
        .disabled {
          color: #aaa;
        }
        .page-indicator {
          font-weight: bold;
        }
      `}</style>
    </div>
  );
};

export default Pagination;
