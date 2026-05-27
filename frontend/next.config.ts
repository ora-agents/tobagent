// next.config.ts
import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const rootDir = dirname(fileURLToPath(import.meta.url));

// Retrieve local IPv4 addresses to permit dynamic HMR & dev resource access on LAN
const localIPs = (() => {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
})();

const nextConfig: NextConfig = {
  turbopack: {
    root: rootDir,
  },
  // Allow webpack-hmr and font loading from any device on local network
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    ...localIPs,
  ],
  // Strip console calls in production builds
  compiler: {
    removeConsole: process.env.NODE_ENV === "production"
      ? {
          exclude: ["error", "warn"], // Keep errors and warnings for critical issues
        }
      : false,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self'",
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
