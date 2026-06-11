import type { NextConfig } from "next";

// next-pwa has no TypeScript types
// eslint-disable-next-line @typescript-eslint/no-require-imports
const withPWA: (config: NextConfig) => NextConfig = require("next-pwa")({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
  buildExcludes: [/middleware-manifest\.json$/],
});

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default withPWA(nextConfig);
