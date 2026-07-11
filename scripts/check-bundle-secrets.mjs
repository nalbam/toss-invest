#!/usr/bin/env node
// Scans the client bundle (.next/static/**/*.js) for forbidden secret-related
// strings. Exits 1 with the offending file + match on any hit, 0 otherwise.
// Server-only isolation (`import 'server-only'` + lib/server/**) should keep
// these strings out of the client bundle entirely.

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const STATIC_DIR = join(process.cwd(), ".next", "static");

const FORBIDDEN = [
  "TOSS_CLIENT_SECRET",
  "TOSS_CLIENT_ID",
  "TOSS_ACCOUNT_SEQ",
  "client_secret",
  "process.env.TOSS_",
  // AI advisor (Phase 4) LLM secrets — server-only (lib/server/llm/**), must
  // never reach the client bundle.
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "process.env.OPENAI",
  "process.env.XAI",
  // News search (lib/server/news/**) and Google OAuth (lib/auth.ts) secrets —
  // also server-only, must never reach the client bundle.
  "TAVILY_API_KEY",
  "process.env.TAVILY",
  "GOOGLE_CLIENT_SECRET",
  "process.env.GOOGLE_CLIENT_SECRET",
];

async function collectJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  if (!existsSync(STATIC_DIR)) {
    console.error(
      `check-bundle-secrets: ${STATIC_DIR} not found. Run a production build first.`,
    );
    process.exit(1);
  }

  const files = await collectJsFiles(STATIC_DIR);
  const findings = [];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const pattern of FORBIDDEN) {
      let index = content.indexOf(pattern);
      while (index !== -1) {
        findings.push({ file, pattern, index });
        index = content.indexOf(pattern, index + pattern.length);
      }
    }
  }

  if (findings.length > 0) {
    console.error("check-bundle-secrets: forbidden strings found in client bundle:");
    for (const { file, pattern, index } of findings) {
      console.error(`  ${file}: "${pattern}" at offset ${index}`);
    }
    process.exit(1);
  }

  console.log(
    `check-bundle-secrets: scanned ${files.length} client bundle file(s), no forbidden strings found.`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("check-bundle-secrets: unexpected error", error);
  process.exit(1);
});
