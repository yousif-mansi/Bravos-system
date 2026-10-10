import type { NextConfig } from "next";

const apiOrigin = process.env.BRAVOS_API_ORIGIN ?? "http://127.0.0.1:3010";

const nextConfig: NextConfig = {
  // The ordinary dev server on port 3000 holds `.next/dev/lock`. Playwright's
  // existing dev server on port 3001 needs its own output directory.
  ...(process.env.BRAVOS_NEXT_DIST_DIR ? { distDir: process.env.BRAVOS_NEXT_DIST_DIR } : {}),
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1"],
  agentRules: false,
  images: { unoptimized: true },
  async rewrites() {
    return [
      {
        source: "/api/public/:path*",
        destination: `${apiOrigin}/api/public/:path*`,
      },
    ];
  },
};

export default nextConfig;
