import { handleError, ok } from "@/lib/server/api/respond";
import { getServerTossClient } from "@/lib/server/toss/container";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const data = await getServerTossClient().getAccounts();
    return ok(data);
  } catch (error) {
    return handleError(error);
  }
}
