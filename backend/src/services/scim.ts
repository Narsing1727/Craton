// SCIM 2.0 provisioning for an organization (RFC 7643, 7644): the identity provider (Okta, Microsoft Entra ID, OneLogin, Google
// Workspace through a connector) creates and removes the organization's people itself, so a leaver loses access the day the
// directory says so, without anyone visiting Craton.
//
// What it does and does not do:
//   - The credential is a token an organization owner makes for that organization; it can manage that organization's membership
//     and nothing else. Only its hash is stored.
//   - An address is accepted only at a domain the organization has VERIFIED (domains.ts), exactly like single sign-on, so the provider
//     cannot name people at someone else's domain.
//   - Provisioning adds the person as a Member. If an account with that address exists and its address was confirmed, it is joined;
//     if the address was never confirmed it is refused (it could be someone else's), and if there is no account one is made, with a
//     confirmed address and no password (the person signs in through the organization's single sign-on).
//   - Deprovisioning (active: false, or DELETE) removes the person from the organization. The account itself stays: it is theirs, and
//     it may belong to other organizations. Owners are never removed this way, so a directory mistake cannot orphan an organization.

import { createHash, randomBytes } from "node:crypto";
import type { Ctx } from "./context.ts";
import { badRequest, conflict, forbidden, notFound } from "./context.ts";
import { addMember, createOAuthUser, getOwner, orgRole } from "./accounts.ts";
import { suggestHandle } from "./oauth.ts";
import { verifiedDomains } from "./domains.ts";
import { config } from "../config.ts";

export const TOKEN_PREFIX = "scim_";
export const MAX_PAGE = 200;

const SCHEMA_USER = "urn:ietf:params:scim:schemas:core:2.0:User";
const SCHEMA_LIST = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const SCHEMA_ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";
const SCHEMA_PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");

/** An error in the shape SCIM clients expect. */
export class ScimError extends Error {
  readonly status: number;
  readonly scimType?: string;
  constructor(status: number, detail: string, scimType?: string) {
    super(detail);
    this.status = status;
    this.scimType = scimType;
  }
  toJSON() {
    return { schemas: [SCHEMA_ERROR], status: String(this.status), ...(this.scimType ? { scimType: this.scimType } : {}), detail: this.message };
  }
}

/** The address an identity provider is given as the SCIM base URL. */
export const baseUrl = (orgHandle: string) => `${config.publicApiUrl}/v1/scim/v2/${orgHandle}`;

// ── Tokens, managed by organization owners ──────────────────────────────────────────────────────────────────────────────────────────

async function ownedOrg(ctx: Ctx, orgHandle: string, actorId: number) {
  const org = await getOwner(ctx, orgHandle);
  if (org.kind !== "org") throw notFound(`Organization ${orgHandle}`);
  const role = await orgRole(ctx, org.id, actorId);
  if (!role) throw notFound(`Organization ${orgHandle}`);
  if (role !== "Owner") throw forbidden(`Only owners of ${org.handle} can manage provisioning.`);
  return org;
}

type TokenRow = { id: number; note: string; created_at: string; last_used_at: string | null };
const tokenView = (r: TokenRow) => ({ id: r.id, note: r.note, createdAt: r.created_at, lastUsedAt: r.last_used_at });

export async function overview(ctx: Ctx, orgHandle: string, actorId: number) {
  const org = await ownedOrg(ctx, orgHandle, actorId);
  const tokens = await ctx.db.all("SELECT id, note, created_at, last_used_at FROM org_scim_tokens WHERE org_id = ? ORDER BY id", org.id) as TokenRow[];
  const provisioned = (await ctx.db.get("SELECT COUNT(*) AS n FROM scim_users WHERE org_id = ?", org.id) as { n: number }).n;
  return { baseUrl: baseUrl(org.handle), tokens: tokens.map(tokenView), provisioned, domains: await verifiedDomains(ctx, org.id) };
}

export async function createToken(ctx: Ctx, orgHandle: string, actorId: number, note: unknown) {
  const org = await ownedOrg(ctx, orgHandle, actorId);
  if (!(await verifiedDomains(ctx, org.id)).length) throw badRequest(`Verify a domain for ${org.handle} first: provisioning only accepts addresses at a verified domain.`);
  const text = typeof note === "string" ? note.trim().slice(0, 80) : "";
  if ((await ctx.db.get("SELECT COUNT(*) AS n FROM org_scim_tokens WHERE org_id = ?", org.id) as { n: number }).n >= 5) {
    throw conflict("too_many_tokens", "An organization can have five provisioning tokens. Remove one first.");
  }
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const id = await ctx.db.insert("INSERT INTO org_scim_tokens (org_id, token_hash, note) VALUES (?, ?, ?)", org.id, sha(token), text);
  return { id, note: text, token, baseUrl: baseUrl(org.handle) };
}

export async function revokeToken(ctx: Ctx, orgHandle: string, actorId: number, id: number) {
  const org = await ownedOrg(ctx, orgHandle, actorId);
  if (!(await ctx.db.run("DELETE FROM org_scim_tokens WHERE id = ? AND org_id = ?", id, org.id)).changes) throw notFound("Token");
}

/** The organization a provisioning token belongs to, for a request that names `orgHandle`. */
export async function authenticate(ctx: Ctx, orgHandle: string, bearer: string | null) {
  if (!bearer || !bearer.startsWith(TOKEN_PREFIX)) throw new ScimError(401, "Send the provisioning token as a Bearer token.");
  const row = await ctx.db.get("SELECT t.id, t.org_id, o.handle FROM org_scim_tokens t JOIN owners o ON o.id = t.org_id WHERE t.token_hash = ?", sha(bearer)) as
    | { id: number; org_id: number; handle: string }
    | undefined;
  if (!row || row.handle.toLowerCase() !== orgHandle.toLowerCase()) throw new ScimError(401, "That token is not valid for this organization.");
  await ctx.db.run("UPDATE org_scim_tokens SET last_used_at = now_iso() WHERE id = ?", row.id);
  return { id: row.org_id, handle: row.handle, tokenId: row.id };
}

// ── Users ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Org = { id: number; handle: string };

type Row = {
  id: number;
  handle: string;
  name: string;
  email: string;
  role: string | null;
  external_id: string | null;
  created_account: number | null;
  created_at: string | null;
  updated_at: string | null;
};

const SELECT = `SELECT o.id, o.handle, o.name, u.email, m.role, s.external_id, s.created_account, s.created_at, s.updated_at
  FROM (SELECT user_id FROM memberships WHERE org_id = ? UNION SELECT user_id FROM scim_users WHERE org_id = ?) x
  JOIN owners o ON o.id = x.user_id JOIN users u ON u.owner_id = o.id
  LEFT JOIN memberships m ON m.org_id = ? AND m.user_id = o.id
  LEFT JOIN scim_users s ON s.org_id = ? AND s.user_id = o.id`;

const resource = (org: Org, r: Row) => ({
  schemas: [SCHEMA_USER],
  id: String(r.id),
  ...(r.external_id ? { externalId: r.external_id } : {}),
  userName: r.email,
  name: { formatted: r.name },
  displayName: r.name,
  emails: [{ value: r.email, type: "work", primary: true }],
  active: r.role !== null,
  meta: { resourceType: "User", created: r.created_at ?? undefined, lastModified: r.updated_at ?? undefined, location: `${baseUrl(org.handle)}/Users/${r.id}` },
});

async function find(ctx: Ctx, org: Org, id: string): Promise<Row> {
  if (!/^\d+$/.test(id)) throw new ScimError(404, `User ${id} not found.`);
  const row = await ctx.db.get(`${SELECT} WHERE o.id = ?`, org.id, org.id, org.id, org.id, Number(id)) as Row | undefined;
  if (!row) throw new ScimError(404, `User ${id} not found.`);
  return row;
}

/** The few filters identity providers send: `attr eq "value"` on userName, externalId, id or emails.value. */
function parseFilter(filter: string | undefined): { column: string; value: string } | null {
  if (!filter?.trim()) return null;
  const m = filter.trim().match(/^([A-Za-z.]+)\s+eq\s+"((?:[^"\\]|\\.)*)"$/i);
  if (!m) throw new ScimError(400, `That filter isn't supported. Use: userName eq "name@example.org" (also externalId, id, emails.value).`, "invalidFilter");
  const value = m[2].replace(/\\(.)/g, "$1");
  switch (m[1].toLowerCase()) {
    case "username":
    case "emails.value":
    case "emails":
      return { column: "u.email", value };
    case "externalid":
      return { column: "s.external_id", value };
    case "id":
      return { column: "CAST(o.id AS TEXT)", value };
    default:
      throw new ScimError(400, `Can't filter on ${m[1]}.`, "invalidFilter");
  }
}

export async function listUsers(ctx: Ctx, org: Org, query: { filter?: string; startIndex?: string; count?: string }) {
  const f = parseFilter(query.filter);
  const start = Math.max(1, Math.floor(Number(query.startIndex ?? 1)) || 1);
  const count = Math.max(0, Math.min(MAX_PAGE, Math.floor(Number(query.count ?? 100)) || 0));
  const where = f ? ` WHERE ${f.column} = ?` : "";
  const args = [org.id, org.id, org.id, org.id, ...(f ? [f.value] : [])];
  const total = (await ctx.db.get(`SELECT COUNT(*) AS n FROM (${SELECT}${where}) t`, ...args) as { n: number }).n;
  const rows = count ? await ctx.db.all(`${SELECT}${where} ORDER BY o.id LIMIT ? OFFSET ?`, ...args, count, start - 1) as Row[] : [];
  return { schemas: [SCHEMA_LIST], totalResults: total, startIndex: start, itemsPerPage: rows.length, Resources: rows.map((r) => resource(org, r)) };
}

export async function getUser(ctx: Ctx, org: Org, id: string) {
  return resource(org, await find(ctx, org, id));
}

type Incoming = {
  userName?: unknown;
  externalId?: unknown;
  displayName?: unknown;
  name?: { formatted?: unknown; givenName?: unknown; familyName?: unknown };
  emails?: { value?: unknown; primary?: unknown }[];
  active?: unknown;
};

/** SCIM sends booleans as true/false, and some providers (Entra) as the strings "True" / "False". */
const truthy = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() === "true" : Boolean(v));

function addressOf(body: Incoming): string {
  const primary = body.emails?.find((e) => e.primary) ?? body.emails?.[0];
  const email = String(typeof body.userName === "string" && body.userName.includes("@") ? body.userName : (primary?.value ?? "")).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new ScimError(400, "userName must be the person's email address.", "invalidValue");
  return email;
}

function nameOf(body: Incoming, email: string): string {
  const parts = [body.name?.givenName, body.name?.familyName].filter((p): p is string => typeof p === "string" && p.trim() !== "");
  const raw = [body.displayName, body.name?.formatted, parts.join(" ")].find((v): v is string => typeof v === "string" && v.trim() !== "") ?? email.split("@")[0];
  return raw.trim().slice(0, 80);
}

const externalOf = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);

async function setExternal(ctx: Ctx, org: Org, userId: number, externalId: string | null, created = false) {
  try {
    await ctx.db.run(
      `INSERT INTO scim_users (org_id, user_id, external_id, created_account) VALUES (?, ?, ?, ?)
       ON CONFLICT (org_id, user_id) DO UPDATE SET external_id = COALESCE(excluded.external_id, scim_users.external_id), updated_at = now_iso()`,
      org.id, userId, externalId, created ? 1 : 0,
    );
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new ScimError(409, "Another user already has that externalId.", "uniqueness");
    throw err;
  }
}

export async function createUser(ctx: Ctx, org: Org, body: Incoming) {
  const email = addressOf(body);
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (!(await verifiedDomains(ctx, org.id)).includes(domain)) {
    throw new ScimError(400, `${email} isn't at a domain ${org.handle} has verified, so it can't be provisioned.`, "invalidValue");
  }
  const existing = await ctx.db.get("SELECT u.owner_id AS id, u.email_verified_at AS verified FROM users u WHERE u.email = ?", email) as { id: number; verified: string | null } | undefined;
  let userId: number;
  let created = false;
  if (existing) {
    if (await orgRole(ctx, org.id, existing.id)) throw new ScimError(409, `${email} is already a member of ${org.handle}.`, "uniqueness");
    if (!existing.verified) throw new ScimError(409, `An account with ${email} exists but its address was never confirmed, so it can't be joined to ${org.handle} automatically.`, "uniqueness");
    userId = existing.id;
  } else {
    const name = nameOf(body, email);
    userId = (await createOAuthUser(ctx, { handle: await suggestHandle(ctx, email, name), email, name })).id;
    created = true;
  }
  await setExternal(ctx, org, userId, externalOf(body.externalId), created);
  if (body.active === undefined || truthy(body.active)) await addMember(ctx, org.id, userId, "Member");
  return resource(org, await find(ctx, org, String(userId)));
}

async function deactivate(ctx: Ctx, org: Org, row: Row) {
  if (row.role === null) return;
  if (row.role === "Owner") throw new ScimError(409, `${row.email} is an owner of ${org.handle}. Owners are removed from Craton's settings, not by provisioning.`, "mutability");
  await ctx.db.run("DELETE FROM memberships WHERE org_id = ? AND user_id = ?", org.id, row.id);
}

async function activate(ctx: Ctx, org: Org, row: Row) {
  if (row.role !== null) return;
  await addMember(ctx, org.id, row.id, "Member");
}

async function apply(ctx: Ctx, org: Org, row: Row, changes: { active?: boolean; externalId?: string | null; name?: string | null; userName?: string }) {
  if (changes.userName !== undefined && changes.userName.toLowerCase() !== row.email.toLowerCase()) {
    throw new ScimError(400, "A person's email address can't be changed by provisioning. Change it in their Craton account.", "mutability");
  }
  if (changes.active === false) await deactivate(ctx, org, row);
  if (changes.active === true) await activate(ctx, org, row);
  if (changes.externalId !== undefined) await setExternal(ctx, org, row.id, changes.externalId, false);
  // The provider owns the name only of accounts it made; someone who already had an account keeps their own.
  if (changes.name && row.created_account) await ctx.db.run("UPDATE owners SET name = ? WHERE id = ?", changes.name.slice(0, 80), row.id);
  await ctx.db.run("UPDATE scim_users SET updated_at = now_iso() WHERE org_id = ? AND user_id = ?", org.id, row.id);
  return resource(org, await find(ctx, org, String(row.id)));
}

export async function replaceUser(ctx: Ctx, org: Org, id: string, body: Incoming) {
  const row = await find(ctx, org, id);
  return apply(ctx, org, row, {
    userName: typeof body.userName === "string" ? body.userName : undefined,
    active: body.active === undefined ? undefined : truthy(body.active),
    externalId: body.externalId === undefined ? undefined : externalOf(body.externalId),
    name: nameOf(body, row.email),
  });
}

/** PATCH, in the two forms providers use: `{ op, path: "active", value }` and `{ op, value: { active: false, ... } }`. */
export async function patchUser(ctx: Ctx, org: Org, id: string, body: { schemas?: unknown; Operations?: { op?: unknown; path?: unknown; value?: unknown }[] }) {
  if (!Array.isArray(body.Operations) || !body.Operations.length) throw new ScimError(400, "Send at least one operation.", "invalidSyntax");
  const row = await find(ctx, org, id);
  const changes: { active?: boolean; externalId?: string | null; name?: string | null; userName?: string } = {};
  const set = (path: string, value: unknown) => {
    switch (path.toLowerCase()) {
      case "active":
        changes.active = truthy(value);
        break;
      case "externalid":
        changes.externalId = externalOf(value);
        break;
      case "username":
        if (typeof value === "string") changes.userName = value;
        break;
      case "displayname":
      case "name.formatted":
        if (typeof value === "string") changes.name = value;
        break;
      default:
        break; // attributes this service does not keep are ignored, as RFC 7644 allows
    }
  };
  for (const op of body.Operations) {
    const kind = String(op.op ?? "").toLowerCase();
    if (!["add", "replace", "remove"].includes(kind)) throw new ScimError(400, `Unknown operation "${String(op.op)}".`, "invalidSyntax");
    if (kind === "remove") {
      if (typeof op.path === "string" && op.path.toLowerCase() === "externalid") changes.externalId = null;
      continue;
    }
    if (typeof op.path === "string" && op.path) set(op.path, op.value);
    else if (op.value && typeof op.value === "object") for (const [k, v] of Object.entries(op.value as Record<string, unknown>)) set(k, v);
  }
  return apply(ctx, org, row, changes);
}

export async function deleteUser(ctx: Ctx, org: Org, id: string) {
  const row = await find(ctx, org, id);
  await deactivate(ctx, org, row);
  await ctx.db.run("DELETE FROM scim_users WHERE org_id = ? AND user_id = ?", org.id, row.id);
}

// ── Discovery ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const serviceProviderConfig = () => ({
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
  documentationUri: `${config.webUrl}/docs`,
  patch: { supported: true },
  bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
  filter: { supported: true, maxResults: MAX_PAGE },
  changePassword: { supported: false },
  sort: { supported: false },
  etag: { supported: false },
  authenticationSchemes: [{ type: "oauthbearertoken", name: "Bearer token", description: "A provisioning token made in the organization's settings.", primary: true }],
});

export const resourceTypes = (org: Org) => ({
  schemas: [SCHEMA_LIST],
  totalResults: 1,
  Resources: [{ schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], id: "User", name: "User", endpoint: "/Users", schema: SCHEMA_USER, meta: { resourceType: "ResourceType", location: `${baseUrl(org.handle)}/ResourceTypes/User` } }],
});

export const schemas = () => ({
  schemas: [SCHEMA_LIST],
  totalResults: 1,
  Resources: [
    {
      id: SCHEMA_USER,
      name: "User",
      description: "A member of the organization",
      attributes: [
        { name: "userName", type: "string", multiValued: false, required: true, mutability: "readOnly", uniqueness: "server" },
        { name: "externalId", type: "string", multiValued: false, required: false, mutability: "readWrite" },
        { name: "displayName", type: "string", multiValued: false, required: false, mutability: "readWrite" },
        { name: "emails", type: "complex", multiValued: true, required: false, mutability: "readOnly" },
        { name: "active", type: "boolean", multiValued: false, required: false, mutability: "readWrite" },
      ],
    },
  ],
});

export { SCHEMA_PATCH };
