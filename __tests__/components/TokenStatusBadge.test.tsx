// TokenStatusBadge guards the scam-override bug: a forward-only token-status promotion can leave a
// honeypot token reading AutoVerified, so the pill must show a red "Scam" instead of the stale verified
// status. A function component is a plain function returning a React element, so we can call it and
// inspect the element tree without a DOM (this runs in the default node environment).
import { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";

import StatusBadge from "../../components/ui/StatusBadge";
import TokenStatusBadge from "../../components/ui/TokenStatusBadge";
import { TokenPairStatus } from "../../types/types";

type Props = Parameters<typeof TokenStatusBadge>[0];
type ElProps = { className?: string; title?: string; status?: TokenPairStatus; children?: ReactNode };

const render = (props: Props): ReactElement<ElProps> => TokenStatusBadge(props) as ReactElement<ElProps>;

const text = (node: ReactNode): string => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  const el = node as ReactElement<{ children?: ReactNode }>;
  return el.props ? text(el.props.children) : "";
};

describe("TokenStatusBadge", () => {
  it("overrides a verified status with a red Scam pill (reason inline at full size)", () => {
    const el = render({ status: TokenPairStatus.AutoVerified, scamFlagged: true, scamReason: "honeypot (simulated buy/sell)" });
    expect(el.props.className).toContain("badge-fail");
    expect(text(el)).toContain("Scam");
    expect(text(el)).toContain("honeypot");
    expect(el.props.title).toContain("honeypot");
  });

  it("delegates to StatusBadge when the token is not scam-flagged", () => {
    const el = render({ status: TokenPairStatus.AutoVerified, scamFlagged: false });
    expect(el.type).toBe(StatusBadge);
    expect(el.props.status).toBe(TokenPairStatus.AutoVerified);
  });

  it("keeps the reason in the tooltip (not inline) at sm size", () => {
    const el = render({ status: TokenPairStatus.AutoVerified, scamFlagged: true, scamReason: "honeypot", size: "sm" });
    expect(text(el)).toContain("Scam");
    expect(text(el)).not.toContain("· honeypot");
    expect(el.props.title).toContain("honeypot");
  });
});
