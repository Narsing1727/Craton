// Step 1 of "Continue with GitHub"; see lib/oauth-routes.ts.
import { startRoute } from "@/lib/oauth-routes";

export const GET = (request: Request) => startRoute(request, "github");
