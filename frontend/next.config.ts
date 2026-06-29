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

const allowedDevOrigins = [
  "localhost",
  "127.0.0.1",
  "wsrtob.s.odn.cc",
  "wsr.wsiri.cn",
  "gen.wsiri.cn",
  ...localIPs,
];

if (process.env.ALLOWED_DEV_ORIGINS) {
  allowedDevOrigins.push(...process.env.ALLOWED_DEV_ORIGINS.split(",").map(d => d.trim()));
}

const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT_MODE === "export" ? "export" : "standalone",
  trailingSlash: process.env.NEXT_OUTPUT_MODE === "export",
  turbopack: {
    root: rootDir,
  },
  // Allow webpack-hmr and font loading from any device on local network
  allowedDevOrigins,
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
          // Required for AudioWorklet + SharedArrayBuffer (self.crossOriginIsolated).
          // Without these, worklet postMessage of Transferable buffers throws
          // DataCloneError: "SharedArrayBuffer transfer requires self.crossOriginIsolated".
          // Use 'credentialless' instead of 'require-corp' to avoid blocking cross-origin
          // resources (e.g., Segment analytics) that don't send Cross-Origin-Resource-Policy headers.
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "credentialless",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
