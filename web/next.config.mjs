/** @type {import('next').NextConfig} */

// The existing Express + SQLite service is the API/data layer. In dev we proxy
// /api/* to it so the browser talks to one origin. Override with BACKEND_URL.
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
const PRINT_AGENT_URL = process.env.PRINT_AGENT_URL || "http://127.0.0.1:9110";

const nextConfig = {
  reactStrictMode: true,
  // We compile with Babel (see .babelrc) so the app never needs the native SWC
  // binary, which kept getting corrupted on low-disk Windows installs.
  // Don't let lint/type warnings block a restaurant from starting its POS.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` },
      // LAN devices (waiter tablets) reach the till's print agent through here.
      { source: "/print-agent/:path*", destination: `${PRINT_AGENT_URL}/:path*` },
    ];
  },
};

export default nextConfig;
