"use server";

// Server actions: every write in the UI goes through here to the Craton API, with the token from
// .env.local. Each returns { ok, data } or { ok: false, error } for the caller to show.

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { parseUnits, UNITS_COOKIE } from "@/lib/units";
import { redirect } from "next/navigation";
import { api, send, type ApiComment, type ApiOwnersPreview, type ApiCitation, type ApiCollaborator, type ApiMilestone, type ApiDelivery, type ApiLock, type ApiSavedFilter, type ApiInvite, type ApiModelReview, type ApiReviewItem, type AuditScope } from "@/lib/api";

const repoPath = (owner: string, repo: string) => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

async function write<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body: unknown, revalidate: string[]) {
  const result = await send<T>(method, path, body);
  if (result.ok) for (const p of revalidate) revalidatePath(p, "layout");
  return result;
}

// ── Stars ──
export async function starAction(owner: string, repo: string, on: boolean) {
  return write<{ starred: boolean; stars: number }>(on ? "PUT" : "DELETE", `${repoPath(owner, repo)}/star`, undefined, [`/${owner}/${repo}`, "/stars"]);
}

// ── Branches ──
export async function createBranchAction(owner: string, repo: string, name: string, from: string) {
  return write<{ name: string }>("POST", `${repoPath(owner, repo)}/branches`, { name, from }, [`/${owner}/${repo}`]);
}
export async function deleteBranchAction(owner: string, repo: string, name: string) {
  return write<null>("DELETE", `${repoPath(owner, repo)}/branches/${name.split("/").map(encodeURIComponent).join("/")}`, undefined, [`/${owner}/${repo}`]);
}

// ── Issues ──
export async function createIssueAction(owner: string, repo: string, input: { title: string; body?: string; label?: string; file?: string | null; assignee?: string | null; milestone?: string | null }) {
  return write<{ number: number }>("POST", `${repoPath(owner, repo)}/issues`, input, [`/${owner}/${repo}`, "/issues", "/dashboard"]);
}
export async function updateIssueAction(owner: string, repo: string, n: number, patch: { state?: "open" | "closed"; label?: string; assignee?: string | null; title?: string; milestone?: string | null }) {
  return write<{ number: number }>("PATCH", `${repoPath(owner, repo)}/issues/${n}`, patch, [`/${owner}/${repo}`, "/issues", "/dashboard"]);
}
export async function commentAction(owner: string, repo: string, target: "issue" | "pull", n: number, body: string) {
  const path = target === "issue" ? `${repoPath(owner, repo)}/issues/${n}/comments` : `${repoPath(owner, repo)}/pulls/${n}/comments`;
  return write<{ id: number; author: string; body: string; createdAt: string }>("POST", path, { body }, [`/${owner}/${repo}`]);
}
export async function editCommentAction(owner: string, repo: string, id: number, body: string) {
  return write<ApiComment>("PATCH", `${repoPath(owner, repo)}/comments/${id}`, { body }, [`/${owner}/${repo}`]);
}
export async function deleteCommentAction(owner: string, repo: string, id: number) {
  return write<null>("DELETE", `${repoPath(owner, repo)}/comments/${id}`, undefined, [`/${owner}/${repo}`]);
}
export async function reactAction(owner: string, repo: string, id: number, emoji: string, on: boolean) {
  return write<ApiComment>(on ? "PUT" : "DELETE", `${repoPath(owner, repo)}/comments/${id}/reactions/${encodeURIComponent(emoji)}`, undefined, []);
}

// ── Pull requests ──
export async function createPullAction(owner: string, repo: string, input: { title: string; body?: string; source: string; target: string }) {
  return write<{ number: number }>("POST", `${repoPath(owner, repo)}/pulls`, input, [`/${owner}/${repo}`, "/pulls", "/dashboard"]);
}
export async function reviewPullAction(owner: string, repo: string, n: number, state: "approved" | "changes_requested" | "commented", body: string) {
  return write<unknown>("POST", `${repoPath(owner, repo)}/pulls/${n}/reviews`, { state, body }, [`/${owner}/${repo}`, "/pulls", "/dashboard"]);
}
export async function mergePullAction(owner: string, repo: string, n: number) {
  return write<{ commit: string }>("POST", `${repoPath(owner, repo)}/pulls/${n}/merge`, {}, [`/${owner}/${repo}`, "/pulls", "/dashboard"]);
}
export async function closePullAction(owner: string, repo: string, n: number) {
  return write<unknown>("POST", `${repoPath(owner, repo)}/pulls/${n}/close`, {}, [`/${owner}/${repo}`, "/pulls", "/dashboard"]);
}

// ── Releases ──
export async function createReleaseAction(owner: string, repo: string, input: { tag: string; target: string; title: string; notes: string; prerelease: boolean }) {
  return write<{ tag: string }>("POST", `${repoPath(owner, repo)}/releases`, input, [`/${owner}/${repo}`]);
}

// ── Repositories ──
/** `sample: true` fills the new repository with the sample project (files, checks, a pull request). */
export async function createRepoAction(input: { owner: string; name: string; description?: string; visibility: "public" | "private"; crs?: string; region?: string; sample?: boolean; card?: string }) {
  return write<{ owner: string; name: string }>("POST", "/repos", input, ["/dashboard", "/explore"]);
}
export async function updateRepoAction(
  owner: string,
  repo: string,
  patch: Partial<{ name: string; description: string; defaultBranch: string; visibility: "public" | "private"; crs: string; nodata: number | null; verticalDatum: number | null; requireChecks: boolean; requireReview: boolean; requireOwnerReview: boolean; requireCog: boolean; license: string; topics: string[]; lockPatterns: string[] }>,
) {
  return write<{ owner: string; name: string }>("PATCH", repoPath(owner, repo), patch, [`/${owner}/${repo}`, "/dashboard"]);
}
export async function deleteRepoAction(owner: string, repo: string) {
  return write<null>("DELETE", repoPath(owner, repo), undefined, ["/dashboard", "/explore"]);
}

// ── Tokens ──
export async function createTokenAction(note: string, scopes: string[], expiresInDays: number | null, repos: string[] = []) {
  return write<{ id: number; token: string }>("POST", "/user/tokens", { note, scopes, expiresInDays, repos }, ["/settings"]);
}
export async function revokeTokenAction(id: number) {
  return write<null>("DELETE", `/user/tokens/${id}`, undefined, ["/settings"]);
}

// ── Organization members ──
export async function inviteMemberAction(org: string, handle: string, role: string) {
  return write<{ handle: string; name: string; role: string }[]>("POST", `/orgs/${encodeURIComponent(org)}/members`, { handle, role }, [`/orgs/${org}`]);
}
export async function setMemberRoleAction(org: string, handle: string, role: string) {
  return write<{ handle: string; name: string; role: string }[]>("PATCH", `/orgs/${encodeURIComponent(org)}/members/${encodeURIComponent(handle)}`, { role }, [`/orgs/${org}`]);
}
export async function removeMemberAction(org: string, handle: string) {
  return write<{ handle: string; name: string; role: string }[]>("DELETE", `/orgs/${encodeURIComponent(org)}/members/${encodeURIComponent(handle)}`, undefined, [`/orgs/${org}`]);
}
export async function updateOrgAction(org: string, patch: { name?: string; bio?: string }) {
  return write<{ handle: string; name: string; bio: string }>("PATCH", `/orgs/${encodeURIComponent(org)}`, patch, [`/orgs/${org}`]);
}
// ── Organization single sign-on (owners) ──
export async function saveSsoAction(org: string, input: { issuer: string; clientId: string; clientSecret?: string }) {
  return write<import("@/lib/api").ApiOrgSso>("PUT", `/orgs/${encodeURIComponent(org)}/sso`, input, [`/orgs/${org}`]);
}
export async function setSsoEnforcedAction(org: string, enforced: boolean) {
  return write<import("@/lib/api").ApiOrgSso>("PATCH", `/orgs/${encodeURIComponent(org)}/sso`, { enforced }, [`/orgs/${org}`]);
}
export async function removeSsoAction(org: string) {
  return write<null>("DELETE", `/orgs/${encodeURIComponent(org)}/sso`, undefined, [`/orgs/${org}`]);
}

// ── Organization domains (owners) ──
const domainPath = (org: string, domain?: string) => `/orgs/${encodeURIComponent(org)}/domains${domain ? `/${encodeURIComponent(domain)}` : ""}`;
export async function addDomainAction(org: string, domain: string) {
  return write<import("@/lib/api").ApiOrgDomain>("POST", domainPath(org), { domain }, [`/orgs/${org}`]);
}
export async function verifyDomainAction(org: string, domain: string) {
  return write<import("@/lib/api").ApiOrgDomain & { joined: number }>("POST", `${domainPath(org, domain)}/verify`, undefined, [`/orgs/${org}`]);
}
export async function setDomainJoinAction(org: string, domain: string, autoJoin: boolean) {
  return write<import("@/lib/api").ApiOrgDomain & { joined: number }>("PATCH", domainPath(org, domain), { autoJoin }, [`/orgs/${org}`]);
}
export async function removeDomainAction(org: string, domain: string) {
  return write<null>("DELETE", domainPath(org, domain), undefined, [`/orgs/${org}`]);
}

export async function deleteOrgAction(org: string, confirm: string) {
  const result = await send<null>("DELETE", `/orgs/${encodeURIComponent(org)}`, { confirm });
  if (!result.ok) return result;
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
export async function createOrgAction(handle: string, name: string) {
  return write<{ handle: string; name: string }>("POST", "/orgs", { handle, name }, ["/dashboard"]);
}

/** Whether an address is already used by a person or organization (public information: their page exists). */
export async function addressTakenAction(handle: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,37}[a-z0-9]$|^[a-z0-9]$/.test(handle)) return { taken: false };
  return { taken: Boolean(await api.owner(handle)) };
}

// ── Command palette ──
/** Repositories the signed-in person can see (or public ones), for jump-to in the palette. */
export async function paletteReposAction() {
  const { loadRepos } = await import("@/lib/source");
  const { repos, live } = await loadRepos();
  return live ? repos.map((r) => ({ owner: r.owner, name: r.name, description: r.description, tags: r.tags, size: r.size })) : null;
}

/** Open issues and pull requests of one repository, so the palette can jump to one by its title. */
export async function paletteRepoWorkAction(owner: string, repo: string) {
  const [issues, pulls] = await Promise.all([api.issues(owner, repo), api.pulls(owner, repo)]);
  return {
    issues: (issues ?? []).filter((i) => i.state === "open").slice(0, 100).map((i) => ({ number: i.number, title: i.title })),
    pulls: (pulls ?? []).filter((p) => p.state === "open").slice(0, 100).map((p) => ({ number: p.number, title: p.title })),
  };
}

// ── File locks ──
export async function lockFileAction(owner: string, repo: string, path: string, reason: string) {
  return write<ApiLock>("POST", `${repoPath(owner, repo)}/locks`, { path, reason }, [`/${owner}/${repo}`]);
}
/** `force` is for a repository admin releasing someone else's lock. */
export async function unlockFileAction(owner: string, repo: string, path: string, force = false) {
  return write<null>("DELETE", `${repoPath(owner, repo)}/locks/${path.split("/").map(encodeURIComponent).join("/")}${force ? "?force=true" : ""}`, undefined, [`/${owner}/${repo}`]);
}

// ── Reads that happen on demand (a dialog opening), so the page doesn't pay for them up front ──
export async function citationAction(owner: string, repo: string): Promise<{ ok: true; data: ApiCitation } | { ok: false; error: string }> {
  const data = await api.citation(owner, repo);
  return data ? { ok: true, data } : { ok: false, error: "Couldn’t load the citation." };
}
export async function pathsAction(owner: string, repo: string, ref: string): Promise<{ ok: true; files: { path: string; size: number }[] } | { ok: false; error: string }> {
  const data = await api.paths(owner, repo, ref);
  return data ? { ok: true, files: data.files } : { ok: false, error: "Couldn’t load the file list." };
}

// ── Webhooks (repository admins) ──
const hooksPath = (owner: string, repo: string) => `${repoPath(owner, repo)}/webhooks`;
const hooksPage = (owner: string, repo: string) => [`/${owner}/${repo}/settings/webhooks`];
/** The signing secret is in the response of this call and nowhere else: show it once. */
export async function createWebhookAction(owner: string, repo: string, input: { url: string; events: string[]; format?: string }) {
  return write<{ id: number; secret?: string }>("POST", hooksPath(owner, repo), input, hooksPage(owner, repo));
}
export async function updateWebhookAction(owner: string, repo: string, id: number, patch: { active?: boolean; events?: string[]; url?: string; format?: string }) {
  return write<{ id: number }>("PATCH", `${hooksPath(owner, repo)}/${id}`, patch, hooksPage(owner, repo));
}
export async function deleteWebhookAction(owner: string, repo: string, id: number) {
  return write<null>("DELETE", `${hooksPath(owner, repo)}/${id}`, undefined, hooksPage(owner, repo));
}
export async function pingWebhookAction(owner: string, repo: string, id: number) {
  return write<null>("POST", `${hooksPath(owner, repo)}/${id}/ping`, undefined, []);
}
export async function redeliverAction(owner: string, repo: string, id: number, delivery: number) {
  return write<null>("POST", `${hooksPath(owner, repo)}/${id}/deliveries/${delivery}/redeliver`, undefined, []);
}
export async function deliveriesAction(owner: string, repo: string, id: number): Promise<{ ok: true; deliveries: ApiDelivery[] } | { ok: false; error: string }> {
  const deliveries = await api.webhookDeliveries(owner, repo, id);
  return deliveries ? { ok: true, deliveries } : { ok: false, error: "Couldn’t load the deliveries." };
}

// ── Restore an earlier version of a file (adds a commit; history is kept) ──
export async function restoreFileAction(owner: string, repo: string, input: { path: string; from: string; branch: string }) {
  return write<{ commit: string }>("POST", `${repoPath(owner, repo)}/restore`, input, [`/${owner}/${repo}`]);
}

// ── Share links (repository admins) ──
/** The address is in this response and nowhere else afterwards: show it once. */
export async function createShareLinkAction(owner: string, repo: string, input: { expiresInDays: number; note: string; ref?: string }) {
  return write<{ id: number; url: string; path: string; expiresAt: string; commit: string; ref: string }>("POST", `${repoPath(owner, repo)}/share-links`, input, [`/${owner}/${repo}/settings/sharing`]);
}
export async function revokeShareLinkAction(owner: string, repo: string, id: number) {
  return write<null>("DELETE", `${repoPath(owner, repo)}/share-links/${id}`, undefined, [`/${owner}/${repo}/settings/sharing`]);
}

// ── Inbox (read / done kept on the account, not the browser) ──
type InboxOp = "read" | "unread" | "done" | "restore";
export async function inboxMarkAction(op: InboxOp, keys: string[]) {
  return send<{ unread: number }>("POST", `/user/inbox/${op}`, { keys });
}
export async function inboxReadAllAction() {
  return send<{ unread: number }>("POST", "/user/inbox/read-all");
}
export async function inboxCountAction(): Promise<number | null> {
  return (await api.inboxCount())?.unread ?? null;
}
export async function inboxListAction(view: "inbox" | "done") {
  const r = await api.inbox(view);
  return r ? { ok: true as const, items: r.items, unread: r.unread } : { ok: false as const, error: "Couldn’t load your notifications." };
}

// ── Milestones ──
export async function createMilestoneAction(owner: string, repo: string, input: { title: string; description?: string; due?: string | null }) {
  return write<ApiMilestone>("POST", `${repoPath(owner, repo)}/milestones`, input, [`/${owner}/${repo}/milestones`, `/${owner}/${repo}/issues`]);
}
export async function updateMilestoneAction(owner: string, repo: string, id: number, patch: { title?: string; description?: string; due?: string | null; state?: "open" | "closed" }) {
  return write<ApiMilestone>("PATCH", `${repoPath(owner, repo)}/milestones/${id}`, patch, [`/${owner}/${repo}/milestones`, `/${owner}/${repo}/issues`]);
}
export async function deleteMilestoneAction(owner: string, repo: string, id: number) {
  return write<{ unassigned: number }>("DELETE", `${repoPath(owner, repo)}/milestones/${id}`, undefined, [`/${owner}/${repo}/milestones`, `/${owner}/${repo}/issues`]);
}

// ── Model reviews ──
const reviewPaths = (owner: string, repo: string) => [`/${owner}/${repo}/reviews`];
export async function createModelReviewAction(owner: string, repo: string, input: { title: string; ref?: string }) {
  return write<ApiModelReview>("POST", `${repoPath(owner, repo)}/model-reviews`, input, reviewPaths(owner, repo));
}
export async function setReviewItemAction(owner: string, repo: string, n: number, key: string, input: { status?: ApiReviewItem["status"]; note?: string }) {
  return write<ApiModelReview>("PUT", `${repoPath(owner, repo)}/model-reviews/${n}/items/${encodeURIComponent(key)}`, input, reviewPaths(owner, repo));
}
export async function addReviewLogAction(owner: string, repo: string, n: number, body: string) {
  return write<ApiModelReview>("POST", `${repoPath(owner, repo)}/model-reviews/${n}/log`, { body }, reviewPaths(owner, repo));
}
export async function refreshReviewEvidenceAction(owner: string, repo: string, n: number, ref?: string) {
  return write<ApiModelReview>("POST", `${repoPath(owner, repo)}/model-reviews/${n}/evidence`, ref ? { ref } : {}, reviewPaths(owner, repo));
}
export async function submitReviewAction(owner: string, repo: string, n: number) {
  return write<ApiModelReview>("POST", `${repoPath(owner, repo)}/model-reviews/${n}/submit`, undefined, reviewPaths(owner, repo));
}
export async function decideReviewAction(owner: string, repo: string, n: number, decision: "approve" | "request_changes", comment: string) {
  return write<ApiModelReview>("POST", `${repoPath(owner, repo)}/model-reviews/${n}/decision`, { decision, comment }, reviewPaths(owner, repo));
}
export async function reopenReviewAction(owner: string, repo: string, n: number, reason: string) {
  return write<ApiModelReview>("POST", `${repoPath(owner, repo)}/model-reviews/${n}/reopen`, { reason }, reviewPaths(owner, repo));
}
export async function deleteModelReviewAction(owner: string, repo: string, n: number) {
  return write<null>("DELETE", `${repoPath(owner, repo)}/model-reviews/${n}`, undefined, reviewPaths(owner, repo));
}

// ── Audit log ──
export async function auditPageAction(scope: AuditScope, q: { actor?: string; outcome?: string; before?: number }) {
  const page = await api.auditLog(scope, { ...q, limit: 50 });
  return page ? ({ ok: true as const, ...page }) : ({ ok: false as const, error: "Couldn’t load the audit log." });
}
export async function tokenRequestsAction(id: number) {
  const list = await api.tokenRequests(id);
  return list ? ({ ok: true as const, requests: list }) : ({ ok: false as const, error: "Couldn’t load this token’s requests." });
}

// ── Collaborators ──
export async function setCollaboratorAction(owner: string, repo: string, handle: string, role: ApiCollaborator["role"]) {
  return write<ApiCollaborator[]>("PUT", `${repoPath(owner, repo)}/collaborators/${encodeURIComponent(handle.replace(/^@/, "").trim())}`, { role }, [`/${owner}/${repo}/settings/collaborators`]);
}
export async function removeCollaboratorAction(owner: string, repo: string, handle: string) {
  return write<ApiCollaborator[]>("DELETE", `${repoPath(owner, repo)}/collaborators/${encodeURIComponent(handle)}`, undefined, [`/${owner}/${repo}`, "/dashboard", "/explore"]);
}

// ── Code owners ──
export async function previewOwnersAction(owner: string, repo: string, text: string) {
  return send<ApiOwnersPreview>("POST", `${repoPath(owner, repo)}/owners/preview`, { text });
}

// ── Display units ──
/** Remember metric or imperial in a cookie (a year), so every page, server-rendered or not, shows the same unit. */
export async function setUnitsAction(units: string) {
  const value = parseUnits(units);
  (await cookies()).set(UNITS_COOKIE, value, { sameSite: "lax", path: "/", maxAge: 365 * 24 * 60 * 60, secure: process.env.NODE_ENV === "production" });
  revalidatePath("/", "layout");
  return { ok: true as const, data: { units: value } };
}

// ── Review requests ──
export async function requestReviewAction(owner: string, repo: string, number: number, handle: string) {
  return write<{ reviewRequests: string[] }>("POST", `${repoPath(owner, repo)}/pulls/${number}/review-requests`, { handle }, [`/${owner}/${repo}/pull/${number}`, "/pulls"]);
}
export async function withdrawReviewRequestAction(owner: string, repo: string, number: number, handle: string) {
  return write<{ reviewRequests: string[] }>("DELETE", `${repoPath(owner, repo)}/pulls/${number}/review-requests/${encodeURIComponent(handle)}`, undefined, [`/${owner}/${repo}/pull/${number}`, "/pulls"]);
}

// ── Invitations by email ──
export async function inviteByEmailAction(owner: string, repo: string, email: string, role: ApiCollaborator["role"]) {
  return write<{ added: boolean; handle?: string; role?: string; invite?: { id: number; email: string; role: string; expiresAt: string } }>("POST", `${repoPath(owner, repo)}/invites`, { email, role }, [`/${owner}/${repo}/settings/collaborators`]);
}
export async function revokeInviteAction(owner: string, repo: string, id: number) {
  return write<null>("DELETE", `${repoPath(owner, repo)}/invites/${id}`, undefined, [`/${owner}/${repo}/settings/collaborators`]);
}
export async function acceptInviteAction(token: string) {
  return send<{ repo: string; role: string }>("POST", "/invites/accept", { token });
}
export async function listInvitesAction(owner: string, repo: string) {
  const list = await api.invites(owner, repo);
  return list ?? ([] as ApiInvite[]);
}

// ── Saved issue and pull request filters ──
export async function listFiltersAction(kind: "issues" | "pulls") {
  const list = await api.savedFilters(kind);
  return list ? { ok: true as const, filters: list } : { ok: false as const, error: "Couldn’t load your saved filters." };
}
export async function saveFilterAction(input: { kind: "issues" | "pulls"; name: string; state: string; label: string; q: string }) {
  return send<ApiSavedFilter>("POST", "/user/filters", input);
}
export async function deleteFilterAction(id: number) {
  return send<null>("DELETE", `/user/filters/${id}`);
}
