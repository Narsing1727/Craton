// Step 1 of "Continue with Google"; see lib/oauth-routes.ts.
import { startRoute } from "@/lib/oauth-routes";

export const GET = (request: Request) => startRoute(request, "google");
