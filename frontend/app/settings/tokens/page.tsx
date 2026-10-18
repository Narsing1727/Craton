import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { TokensView, type TokenRow } from "./tokens-view";
import { api } from "@/lib/api";
import { noData } from "@/lib/source";
import { tokens as demoTokens } from "@/lib/data";
import { formatDate, timeAgo } from "@/lib/format";

export const metadata: Metadata = {
  title: "Personal access tokens",
  description: "Tokens for the Craton CLI, CI jobs and scripts.",
};

export default async function TokensPage() {
  await requireUser("/settings/tokens");
  const live = await api.tokens();
  if (!live) await noData();
  const rows: TokenRow[] = live
    ? live.map((t) => ({
        id: t.id,
        name: t.note,
        created: formatDate(t.created_at),
        lastUsed: t.last_used_at ? timeAgo(t.last_used_at) : "Never",
        scope: t.scopes.split(",").join(", "),
        expires: t.expires_at ? `Expires ${formatDate(t.expires_at)}` : "Never expires",
        current: t.current,
        repos: t.repos ?? undefined,
      }))
    : demoTokens.map((t, i) => ({ id: i + 1, ...t }));
  return <TokensView initial={rows} live={live !== null} />;
}
