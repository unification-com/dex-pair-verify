import React, { useEffect, useRef, useState } from "react";

import Icon from "./Icon";

// Debounced, SERVER-DRIVEN search input. Like the chain/dex dropdowns, typing
// navigates (onSearch → router.push ?q=) so the WHOLE dataset is filtered in the
// gSSP query and pagination resets — not just the rows on the current page. Shared
// by the pairs + tokens lists (operator + public). Self-styled (styled-jsx doesn't
// pierce component boundaries, so the icon-input styling must live here).
const SearchBox: React.FC<{ value: string; placeholder: string; onSearch: (q: string) => void }> = ({ value, placeholder, onSearch }) => {
  const [q, setQ] = useState(value);
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;

  // Sync when navigation changes the active query (e.g. a chain switch resets it).
  useEffect(() => {
    setQ(value);
  }, [value]);

  // Debounce: navigate ~400ms after the last keystroke, only when it actually changed.
  useEffect(() => {
    if (q.trim() === value) {
      return;
    }
    const t = setTimeout(() => onSearchRef.current(q.trim()), 400);
    return () => clearTimeout(t);
  }, [q, value]);

  return (
    <span className="ico-input">
      <Icon name="search" size={14} />
      <input className="input" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      <style jsx>{`
        .ico-input { position: relative; display: inline-flex; align-items: center; flex: 1; min-width: 220px; }
        .ico-input :global(.ico) { position: absolute; left: 10px; color: var(--text-2); }
        .ico-input .input { width: 100%; padding-left: 30px; }
      `}</style>
    </span>
  );
};

export default SearchBox;
