import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression guard for the auth architecture invariant (architecture.md
// "API 라우트"): every `/api/*` route must re-verify the session via
// `withAuth`, since the edge `middleware.ts` only checks that a session
// cookie is present (a forged cookie still passes it). A route added without
// `withAuth` would silently expose Toss data / order execution to anyone.
// This test statically checks every `route.ts` file rather than invoking each
// handler, so it also catches a route that never even imports `withAuth`.

const API_DIR = join(__dirname); // app/api

// Documented, deliberate exceptions (see architecture.md):
// - api/auth/[...all]: better-auth's own handler (`toNextJsHandler`).
// - api/advisor-jobs/run: machine-to-machine route authenticated by its own
//   Bearer token check (constant-time compare) instead of a user session.
const EXEMPT_ROUTES = new Set(["auth/[...all]/route.ts", "advisor-jobs/run/route.ts"]);

const HTTP_VERBS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

function findRouteFiles(dir: string, base = ""): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...findRouteFiles(join(dir, entry.name), relPath));
    } else if (entry.name === "route.ts") {
      files.push(relPath);
    }
  }
  return files;
}

describe("every non-exempt API route is wrapped in withAuth", () => {
  const routeFiles = findRouteFiles(API_DIR).filter((f) => !EXEMPT_ROUTES.has(f));

  it("found the expected non-exempt route files (sanity check for this test itself)", () => {
    // Guards against the walk silently matching nothing (e.g. a directory
    // rename) and every case below vacuously passing.
    expect(routeFiles.length).toBeGreaterThan(20);
  });

  it.each(routeFiles)("%s wraps every exported HTTP handler in withAuth", (relPath) => {
    const source = readFileSync(join(API_DIR, relPath), "utf8");

    // A bare exported handler function (not a `const X = withAuth(...)`
    // assignment) would bypass withAuth entirely.
    for (const verb of HTTP_VERBS) {
      expect(source).not.toMatch(new RegExp(`export\\s+(async\\s+)?function\\s+${verb}\\b`));
    }

    const assignments = [
      ...source.matchAll(
        new RegExp(`export const (${HTTP_VERBS.join("|")})\\s*=\\s*([A-Za-z_$][\\w$]*)\\(`, "g"),
      ),
    ];
    expect(assignments.length).toBeGreaterThan(0);
    for (const [, verb, wrapper] of assignments) {
      expect(wrapper, `${relPath} exports ${verb} via "${wrapper}(...)", expected "withAuth(...)"`).toBe(
        "withAuth",
      );
    }
  });
});
