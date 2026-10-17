import { twinResponse } from "@/lib/markdown-twin";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => twinResponse(req, "/about");
