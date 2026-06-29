import { createAuthClient } from "better-auth/react";

/**
 * Browser-side auth client. baseURL defaults to the current origin, so the
 * client talks to the `/api/auth/*` route handler automatically.
 */
export const authClient = createAuthClient();
