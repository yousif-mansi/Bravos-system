import type { NextConfig } from "next";

const apiOrigin = process.env.BRAVOS_API_ORIGIN ?? "http://127.0.0.1:3010";

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
