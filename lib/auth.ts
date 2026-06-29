import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { isEmailAllowed, parseAllowedDomains } from "@/lib/auth/allowlist";

const allowedDomains = parseAllowedDomains(process.env.AUTH_ALLOWED_DOMAINS);

/**
 * better-auth server instance. Backed by its own SQLite file (separate from the
 * advisor DB) so the auth schema never collides with app tables. Native
 * better-sqlite3 keeps this module Node-only — never import it from middleware
 * (the Edge runtime), which checks the session cookie instead.
 *
 * The Google domain gate lives in `databaseHooks.user.create.before`: OAuth
 * sign-ins create a user during the provider callback, so rejecting there blocks
 * any non-`nalbam.com` account before its user record is ever written.
 */
export const auth = betterAuth({
  database: new Database(process.env.AUTH_DB_PATH ?? "data/auth.db"),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (
            user.emailVerified === false ||
            !isEmailAllowed(user.email, allowedDomains)
          ) {
            throw new APIError("FORBIDDEN", {
              message: `Only ${allowedDomains.join(", ")} accounts are allowed.`,
            });
          }
          return { data: user };
        },
      },
    },
  },
});
