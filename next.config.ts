import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module; keep it external so it is required at
  // runtime instead of being bundled by the server build.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
