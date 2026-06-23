// Triggers one background advisor pass via the protected route.
//
// Usage:   ADVISOR_JOBS_TOKEN=xxx node scripts/advisor-run.mjs [baseUrl]
// Cron:    */5 * * * * ADVISOR_JOBS_TOKEN=xxx node /path/to/scripts/advisor-run.mjs
//
// baseUrl defaults to ADVISOR_BASE_URL or http://localhost:4107.

const base = process.argv[2] ?? process.env.ADVISOR_BASE_URL ?? "http://localhost:4107";
const token = process.env.ADVISOR_JOBS_TOKEN;

if (!token) {
  console.error("ADVISOR_JOBS_TOKEN is required");
  process.exit(1);
}

const res = await fetch(`${base}/api/advisor-jobs/run`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}` },
});
const body = await res.json().catch(() => null);
console.log(JSON.stringify(body, null, 2));
process.exit(res.ok ? 0 : 1);
