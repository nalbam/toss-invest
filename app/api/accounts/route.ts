import { handleError, ok } from "@/lib/server/api/respond";
import { withAuth } from "@/lib/server/auth/with-auth";
import { getServerTossClient } from "@/lib/server/toss/container";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (): Promise<Response> => {
  try {
    const data = await getServerTossClient().getAccounts();
    return ok(data);
  } catch (error) {
    return handleError(error);
  }
});
