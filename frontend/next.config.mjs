const dev = process.env.NODE_ENV !== "production";

// The basemaps under the map viewer (lib/basemaps.ts); MapLibre fetches their tiles and draws in a worker.
const basemaps = "https://tile.openstreetmap.org https://server.arcgisonline.com https://tile.opentopomap.org";

// Everything the app loads is its own: fonts are self-hosted by next/font, previews come through
// the render route. Next.js needs inline scripts for hydration; dev also needs eval (React
// Refresh) and a websocket (HMR).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${basemaps}`,
  "font-src 'self' data:",
  `connect-src 'self' ${basemaps}${dev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  // Only over HTTPS in production; a dev server on http://localhost must not pin HSTS.
  ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // A second build can go beside the running one (CRATON_DIST_DIR=.next-prod) without disturbing it.
  distDir: process.env.CRATON_DIST_DIR || ".next",
  output: "standalone",
  reactStrictMode: false,
  poweredByHeader: false,
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // A share link's address is its password: keep it out of Referer headers, caches and search results.
      {
        source: "/s/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
