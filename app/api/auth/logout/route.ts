import { destroySession } from "@/lib/auth/session";
import { ok, fail } from "@/lib/api/response";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  try {
    await destroySession();
    return ok({ loggedOut: true });
  } catch {
    return fail("Logout failed.", 500);
  }
}
