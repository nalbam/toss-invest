// Populate the local name-search directory (stock_directory) from an
// AUTHORITATIVE listing — a wrong code maps to the wrong stock, so only trusted
// sources are used (KRX official corp list, Nasdaq Trader symbol file).
//
// Usage:
//   node scripts/seed-stocks.mjs --krx            # KOSPI/KOSDAQ/KONEX (KRW)
//   node scripts/seed-stocks.mjs --nasdaq         # US (USD)
//   node scripts/seed-stocks.mjs --all            # both
//   node scripts/seed-stocks.mjs path/to.json     # custom JSON array
//       (shape: [{ symbol, name, market?, currency? }] — see stocks.example.json)
//   ADVISOR_DB_PATH=data/advisor.db node scripts/seed-stocks.mjs --krx

import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

const KRX_URL =
  "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13";
const NASDAQ_URL =
  "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt";
function krxMarket(label) {
  if (label.includes("코스닥")) return "KOSDAQ";
  if (label.includes("코넥스")) return "KONEX";
  if (label.includes("유가")) return "KOSPI";
  return label || null;
}

function cellText(html) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchKrx() {
  const res = await fetch(KRX_URL);
  if (!res.ok) throw new Error(`KRX request failed: ${res.status}`);
  const html = new TextDecoder("euc-kr").decode(
    Buffer.from(await res.arrayBuffer()),
  );
  const rows = [];
  for (const tr of html.split(/<tr>/i).slice(1)) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      cellText(m[1]),
    );
    if (cells.length < 3) continue;
    const name = cells[0];
    const symbol = cells[2];
    if (!name || !/^[0-9A-Za-z]{6}$/.test(symbol)) continue;
    rows.push({
      symbol,
      name,
      market: krxMarket(cells[1] ?? ""),
      currency: "KRW",
    });
  }
  return rows;
}

async function fetchNasdaq() {
  const res = await fetch(NASDAQ_URL);
  if (!res.ok) throw new Error(`Nasdaq request failed: ${res.status}`);
  const lines = (await res.text()).split("\n");
  const header = lines[0].split("|");
  const symIdx = header.indexOf("Symbol");
  const nameIdx = header.indexOf("Security Name");
  if (symIdx < 0 || nameIdx < 0) throw new Error("Unexpected Nasdaq header");
  const rows = [];
  for (const line of lines.slice(1)) {
    if (!line || line.startsWith("File Creation Time")) continue;
    const cols = line.split("|");
    const symbol = cols[symIdx]?.trim();
    const name = cols[nameIdx]?.trim();
    if (!symbol || !name || !/^[A-Za-z0-9.\-]+$/.test(symbol)) continue;
    rows.push({ symbol, name, market: "US", currency: "USD" });
  }
  return rows;
}

function fromFile(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error("Expected a JSON array of { symbol, name, market?, currency? }");
  }
  return parsed;
}

async function collect(args) {
  const all = args.includes("--all");
  const out = [];
  if (all || args.includes("--krx")) out.push(...(await fetchKrx()));
  if (all || args.includes("--nasdaq")) out.push(...(await fetchNasdaq()));
  const file = args.find((a) => !a.startsWith("--"));
  if (file) out.push(...fromFile(file));
  if (out.length === 0) {
    throw new Error("Nothing to seed. Pass --krx, --nasdaq, --all, or a JSON file path.");
  }
  return out;
}

const dbPath = process.env.ADVISOR_DB_PATH ?? "data/advisor.db";
let stocks;
try {
  stocks = await collect(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.exec(
  `CREATE TABLE IF NOT EXISTS stock_directory (
     symbol TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     market TEXT,
     currency TEXT,
     updated_at TEXT NOT NULL
   );`,
);

const stmt = db.prepare(
  `INSERT INTO stock_directory (symbol, name, market, currency, updated_at)
   VALUES (@symbol, @name, @market, @currency, @updatedAt)
   ON CONFLICT(symbol)
     DO UPDATE SET name = excluded.name, market = excluded.market,
       currency = excluded.currency, updated_at = excluded.updated_at`,
);
const now = new Date().toISOString();
let seeded = 0;
let skipped = 0;
const tx = db.transaction((rows) => {
  for (const row of rows) {
    if (!row || typeof row.symbol !== "string" || typeof row.name !== "string") {
      skipped += 1;
      continue;
    }
    stmt.run({
      symbol: row.symbol,
      name: row.name,
      market: row.market ?? null,
      currency: row.currency ?? null,
      updatedAt: now,
    });
    seeded += 1;
  }
});
tx(stocks);

console.log(`seeded ${seeded} stocks into ${dbPath}${skipped ? ` (skipped ${skipped} invalid)` : ""}`);
