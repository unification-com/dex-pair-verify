// next.config.js
// Redirect the retired /admin/* UI routes to their public-route equivalents (the UI
// moved off /admin; the gated /api/admin/* endpoints are unchanged). Keeps old
// bookmarks + the go-ooo docs from 404ing. Order matters — first match wins, so the
// renamed routes precede the single-segment catch-all.
module.exports = {
  async redirects() {
    return [
      { source: "/admin/list-pairs", destination: "/pairs", permanent: false },
      { source: "/admin/list-tokens", destination: "/tokens", permanent: false },
      { source: "/admin/p/test/:path*", destination: "/price-test/:path*", permanent: false },
      { source: "/admin/p/:id", destination: "/p/:id", permanent: false },
      { source: "/admin/t/:id", destination: "/t/:id", permanent: false },
      { source: "/admin", destination: "/", permanent: false },
      // sources, help, ingest, identitycheck, canonicalcheck, factorycheck,
      // scancheck, revalidate, thresholds — same slug at the root.
      { source: "/admin/:slug", destination: "/:slug", permanent: false },
    ];
  },
};
