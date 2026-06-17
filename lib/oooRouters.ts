// lib/oooRouters.ts
// The OoO Router registry (T8 / provider auth): chainId → { name, router, rpc } for every network the
// xFUND OoO Router is deployed on. The provider-auth gate maps the chainId a go-ooo instance reports to
// that chain's Router + RPC and checks the wallet's registration there. Router addresses are from the
// OoO contract docs (docs.unification.io/ooo/contracts.html); RPCs default to keyless public endpoints
// (the truffle-config providers, swapped to keyless publicnode where the config used Infura) and are
// env-overridable per chain via OOO_ROUTER_RPC_<chainId>. A chain not built in here (e.g. a local
// anvil dev net) can be added entirely via env: OOO_ROUTER_RPC_<id> + OOO_ROUTER_ADDRESS_<id>.

export type OooRouter = { chainId: number; name: string; router: string; rpc: string };

// Built-in deployments. Shibarium (109) + QoM (766) share a Router *address* but are distinct chains —
// chainId selects which RPC to call. RPCs are keyless defaults; override with OOO_ROUTER_RPC_<chainId>.
const ROUTERS: Record<number, { name: string; router: string; defaultRpc: string }> = {
  1: { name: "eth", router: "0x9ac9AE20a17779c17b069b48A8788e3455fC6121", defaultRpc: "https://ethereum-rpc.publicnode.com" },
  137: { name: "polygon", router: "0x5E9405888255C142207Ab692C72A8cd6fc85C3A2", defaultRpc: "https://polygon-bor-rpc.publicnode.com" },
  109: { name: "shibarium", router: "0x2E9ade949900e19735689686E61BF6338a65B881", defaultRpc: "https://rpc.shibrpc.com" },
  766: { name: "qom", router: "0x2E9ade949900e19735689686E61BF6338a65B881", defaultRpc: "https://rpc.qom.one" },
  11155111: { name: "sepolia", router: "0xf6b5d6eafE402d22609e685DE3394c8b359CaD31", defaultRpc: "https://ethereum-sepolia-rpc.publicnode.com" },
  157: { name: "puppynet", router: "0x7a99f98EfC7C1313E3a8FA4Be36aE2b100a1622F", defaultRpc: "https://puppynet.shibrpc.com" },
};

const envRpc = (chainId: number): string | undefined => process.env[`OOO_ROUTER_RPC_${chainId}`];
const envAddr = (chainId: number): string | undefined => process.env[`OOO_ROUTER_ADDRESS_${chainId}`];

// Resolve the Router config for a chainId, applying env overrides. Returns null for a chain the OoO
// Router isn't deployed on (the auth gate then rejects — registration can't be verified there).
export function oooRouterForChain(chainId: number): OooRouter | null {
  const base = ROUTERS[chainId];
  if (base) {
    return { chainId, name: base.name, router: envAddr(chainId) ?? base.router, rpc: envRpc(chainId) ?? base.defaultRpc };
  }
  // Not built in — usable only if BOTH the RPC and Router address are supplied via env (a dev/anvil net).
  const rpc = envRpc(chainId);
  const addr = envAddr(chainId);
  if (rpc && addr) {
    return { chainId, name: `chain-${chainId}`, router: addr, rpc };
  }
  return null;
}

// Is the OoO Router deployed (and resolvable) on this chain?
export const isOooChain = (chainId: number): boolean => oooRouterForChain(chainId) !== null;
