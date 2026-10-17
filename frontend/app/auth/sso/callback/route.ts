// Step 2: the organization's provider sent the browser back here; see lib/oauth-routes.ts.
import { callbackRoute } from "@/lib/oauth-routes";

export const GET = (request: Request) => callbackRoute(request, "sso");
