import type { NextConfig } from "next";

import { version } from "./package.json";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone) so the Docker
  // runtime image ships `node server.js` with only the traced node_modules.
  output: "standalone",
  // better-sqlite3 is a native module; keep it external so it is required at
  // runtime instead of being bundled by the server build.
  serverExternalPackages: ["better-sqlite3"],
  // Expose the package version to the client so the UI can show it.
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
};

export default nextConfig;
