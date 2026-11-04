// components/ui/Icon.tsx
// Minimal stroke-icon set used across the UI. 20×20 viewBox, currentColor
// stroke so icons inherit text colour. Add new glyphs to ICONS as needed.
import React from "react";

const ICONS: Record<string, string[]> = {
  home: ["M3 9.5L10 4l7 5.5V16a1 1 0 0 1-1 1h-3v-4H7v4H4a1 1 0 0 1-1-1z"],
  queue: ["M3 5h14M3 10h14M3 15h9"],
  token: ["M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M10 6.5v7M7.5 8.2h3.2a1.3 1.3 0 0 1 0 2.6H8"],
  pipeline: ["M4 6h5M4 10h8M4 14h5", "M14 5.5l2 1.5-2 1.5z"],
  price: ["M3 16V4M3 16h14", "M6 12l3-4 3 2 4-6"],
  check: ["M4 10.5l3.5 3.5L16 6"],
  x: ["M5 5l10 10M15 5L5 15"],
  dash: ["M5 10h10"],
  chevL: ["M12 5l-5 5 5 5"],
  chevR: ["M8 5l5 5-5 5"],
  chevD: ["M5 8l5 5 5-5"],
  ext: ["M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3", "M12 4h4v4M16 4l-6 6"],
  search: ["M9 3a6 6 0 1 0 0 12A6 6 0 0 0 9 3zM17 17l-3.5-3.5"],
  refresh: ["M15.5 8A6 6 0 1 0 16 11", "M16 4v4h-4"],
  bolt: ["M11 3L5 11h4l-1 6 6-8h-4z"],
  shield: ["M10 3l6 2v4c0 4-2.7 6.5-6 8-3.3-1.5-6-4-6-8V5z"],
  copy: ["M7 7h8v8H7z", "M5 13H4V4h9v1"],
  alert: ["M10 3l8 14H2z", "M10 8v4M10 14.5v.5"],
  dup: ["M7 7h8v8H7z", "M5 13V5h8"],
  play: ["M6 4l9 6-9 6z"],
  clock: ["M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12z", "M10 7v3.5l2.5 1.5"],
  filter: ["M3 5h14l-5 6v4l-4 2v-6z"],
  arrowR: ["M4 10h11M11 6l4 4-4 4"],
  logout: ["M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3", "M12 7l3 3-3 3M15 10H7"],
  help: ["M10 4a6 6 0 1 0 0 12A6 6 0 0 0 10 4z", "M8.5 8.2a1.5 1.5 0 0 1 2.9.4c0 1-1.4 1.3-1.4 2.2", "M10 13.4v.4"],
  layers: ["M10 3l7 4-7 4-7-4z", "M3 11l7 4 7-4"],
  plus: ["M10 4v12M4 10h12"],
  menu: ["M3 6h14M3 10h14M3 14h14"],
};

export type IconName = keyof typeof ICONS;

const Icon: React.FC<{ name: IconName | string; size?: number; className?: string }> = ({ name, size = 16, className }) => (
  <svg className={"ico" + (className ? " " + className : "")} width={size} height={size} viewBox="0 0 20 20"
    fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {(ICONS[name] || []).map((d, i) => <path key={i} d={d} />)}
  </svg>
);

export default Icon;
