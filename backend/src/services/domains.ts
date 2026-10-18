// Organization domains: an owner proves an organization controls a domain (hydrolab.org) by publishing a DNS TXT record,
// and from then on
//   - the organization shows the domain as verified, so visitors can tell it is who it says it is;
//   - optionally, anyone whose CONFIRMED email address is at that domain joins as a Member (no invitations to send).
//
// Only one organization can hold a domain once it is verified. A free-mail domain (gmail.com) or a public suffix (co.uk)
// is never accepted, because nobody controls those. Joining only ever follows a confirmed address: an unconfirmed one
// proves nothing, so signing up as someone@hydrolab.org without access to that mailbox gets no membership.

import dns from "node:dns";
import { randomBytes } from "node:crypto";
import type { Ctx } from "./context.ts";
import { ApiError, badRequest, conflict, forbidden, notFound } from "./context.ts";
import { addMember, getOwner, orgRole } from "./accounts.ts";

export const RECORD_PREFIX = "_craton-challenge";
const MAX_DOMAINS = 10;

/** The DNS lookup, replaceable so tests need no network. */
export const resolver = { txt: (name: string): Promise<string[][]> => dns.promises.resolveTxt(name) };

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "pm.me",
  "aol.com", "gmx.com", "gmx.net", "mail.com", "zoho.com", "yandex.com", "yandex.ru", "qq.com", "163.com", "126.com", "rediffmail.com", "fastmail.com", "tutanota.com", "hey.com",
]);
/** Second-level names that are public suffixes in many countries (co.in is not an organization). */
const SUFFIX_LABELS = new Set(["co", "com", "org", "net", "ac", "edu", "gov", "nic", "res", "mil", "ltd", "plc", "sch", "ne", "or", "go"]);

/** A clean, lower-case domain from what a person typed (a pasted URL or email is fine), or a plain reason it cannot be used. */
export function normalizeDomain(input: unknown): string {
  let d = String(input ?? "").trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, "").replace(/^[^@/]*@/, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "").replace(/^www\./, "");
  if (!d) throw badRequest("Enter a domain, like hydrolab.org.");
  if (d.length > 253 || !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) throw badRequest(`“${d.slice(0, 60)}” isn’t a domain name. Use something like hydrolab.org.`);
  if (FREE_MAIL.has(d)) throw badRequest(`${d} is a public email service: nobody can prove they control it, so it can’t be an organization’s domain.`);
  const labels = d.split(".");
  if (labels.length === 2 && SUFFIX_LABELS.has(labels[0])) throw badRequest(`${d} is a public suffix, shared by many organizations. Use your own name under it, like yourname.${d}.`);
  return d;
}

const emailDomain = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase();

type Row = { id: number; org_id: number; domain: string; token: string; verified_at: string | null; auto_join: number; created_at: string };

const recordFor = (r: Row) => ({ type: "TXT", name: `${RECORD_PREFIX}.${r.domain}`, value: `craton-verify=${r.token}` });

function json(r: Row) {
  return { domain: r.domain, verified: Boolean(r.verified_at), verifiedAt: r.verified_at, autoJoin: Boolean(r.auto_join), createdAt: r.created_at, ...(r.verified_at ? {} : { record: recordFor(r) }) };
}

/** Owners only: everything here is about who can join. */
async function ownedOrg(ctx: Ctx, orgHandle: string, actorId: number) {
  const org = await getOwner(ctx, orgHandle);
  if (org.kind !== "org") throw notFound(`Organization ${orgHandle}`);
  const role = await orgRole(ctx, org.id, actorId);
  if (!role) throw notFound(`Organization ${orgHandle}`);
  if (role !== "Owner") throw forbidden(`Only owners of ${org.handle} can manage its domains.`);
  return org;
}

async function find(ctx: Ctx, orgId: number, domain: string): Promise<Row> {
  const row = await ctx.db.get("SELECT * FROM org_domains WHERE org_id = ? AND domain = ?", orgId, normalizeDomain(domain)) as Row | undefined;
  if (!row) throw notFound("Domain");
  return row;
}

export async function listDomains(ctx: Ctx, orgHandle: string, actorId: number) {
  const org = await ownedOrg(ctx, orgHandle, actorId);
  return (await ctx.db.all("SELECT * FROM org_domains WHERE org_id = ? ORDER BY domain", org.id) as Row[]).map(json);
}

/** The domains an organization has verified: shown on its public profile. */
export async function verifiedDomains(ctx: Ctx, orgId: number): Promise<string[]> {
  return (await ctx.db.all("SELECT domain FROM org_domains WHERE org_id = ? AND verified_at IS NOT NULL ORDER BY domain", orgId) as { domain: string }[]).map((r) => r.domain);
}

export async function addDomain(ctx: Ctx, orgHandle: string, actorId: number, input: unknown) {
  const org = await ownedOrg(ctx, orgHandle, actorId);
  const domain = normalizeDomain(input);
  if (await ctx.db.get("SELECT 1 FROM org_domains WHERE org_id = ? AND domain = ?", org.id, domain)) throw conflict("domain_exists", `${domain} is already on ${org.handle}.`);
  const holder = await ctx.db.get("SELECT o.handle FROM org_domains d JOIN owners o ON o.id = d.org_id WHERE d.domain = ? AND d.verified_at IS NOT NULL", domain) as { handle: string } | undefined;
  if (holder) throw conflict("domain_taken", `${domain} is already verified by another organization. If it is yours, ask them to remove it, or contact support.`);
  if ((await ctx.db.get("SELECT COUNT(*) AS n FROM org_domains WHERE org_id = ?", org.id) as { n: number }).n >= MAX_DOMAINS) throw badRequest(`An organization can have up to ${MAX_DOMAINS} domains.`);
  await ctx.db.run("INSERT INTO org_domains (org_id, domain, token) VALUES (?, ?, ?)", org.id, domain, randomBytes(18).toString("hex"));
  return json(await find(ctx, org.id, domain));
}

/** Look for the TXT record. A record not there yet is the common case, so the answer says exactly what was and was not found. */
export async function verifyDomain(ctx: Ctx, orgHandle: string, actorId: number, domain: string) {
  const org = await ownedOrg(ctx, orgHandle, actorId);
  const row = await find(ctx, org.id, domain);
  if (row.verified_at) return { ...json(row), joined: 0 };
  const rec = recordFor(row);
  let values: string[] = [];
  try {
    values = (await resolver.txt(rec.name)).map((chunks) => chunks.join(""));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOTFOUND" && code !== "ENODATA" && code !== "NXDOMAIN") {
      throw new ApiError(502, "dns_error", "Couldn’t look up DNS just now. Try again in a minute.");
    }
  }
  if (!values.includes(rec.value)) {
    throw new ApiError(
      422,
      "dns_record_missing",
      values.length
        ? `Found ${values.length === 1 ? "a TXT record" : `${values.length} TXT records`} at ${rec.name}, but not the one Craton expects. It must be exactly: ${rec.value}`
        : `No TXT record at ${rec.name} yet. Add one with the value ${rec.value}, then try again (DNS changes can take a few minutes).`,
      { record: rec },
    );
  }
  try {
    await ctx.db.run("UPDATE org_domains SET verified_at = now_iso() WHERE id = ?", row.id);
  } catch {
    // Another organization verified it first (the unique index on verified domains).
    throw conflict("domain_taken", `${row.domain} was just verified by another organization.`);
  }
  const done = await find(ctx, org.id, row.domain);
  return { ...json(done), joined: done.auto_join ? await backfill(ctx, org.id, done.domain) : 0 };
}

export async function setAutoJoin(ctx: Ctx, orgHandle: string, actorId: number, domain: string, on: unknown) {
  const org = await ownedOrg(ctx, orgHandle, actorId);
  const row = await find(ctx, org.id, domain);
  if (typeof on !== "boolean") throw badRequest("Send { autoJoin: true } or { autoJoin: false }.");
  if (!row.verified_at) throw badRequest(`Verify ${row.domain} first: joining by email address only makes sense for a domain the organization has proved it controls.`);
  await ctx.db.run("UPDATE org_domains SET auto_join = ? WHERE id = ?", on ? 1 : 0, row.id);
  return { ...json(await find(ctx, org.id, row.domain)), joined: on ? await backfill(ctx, org.id, row.domain) : 0 };
}

export async function removeDomain(ctx: Ctx, orgHandle: string, actorId: number, domain: string) {
  const org = await ownedOrg(ctx, orgHandle, actorId);
  const row = await find(ctx, org.id, domain);
  // Members who joined through it stay: leaving is their choice or an owner's, never a side effect of a DNS record.
  await ctx.db.run("DELETE FROM org_domains WHERE id = ?", row.id);
}

/** Add every existing person with a confirmed address at the domain who is not a member yet. Returns how many joined. */
async function backfill(ctx: Ctx, orgId: number, domain: string): Promise<number> {
  const people = await ctx.db.all("SELECT owner_id, email FROM users WHERE email_verified_at IS NOT NULL AND lower(email) LIKE ?", `%@${domain}`) as { owner_id: number; email: string }[];
  let joined = 0;
  for (const p of people) {
    if (emailDomain(p.email) !== domain || await orgRole(ctx, orgId, p.owner_id)) continue;
    await addMember(ctx, orgId, p.owner_id, "Member");
    joined++;
  }
  return joined;
}

/** After a person's address is confirmed (or an identity provider vouched for it): join the organizations that verified its domain. */
export async function joinForUser(ctx: Ctx, userId: number): Promise<string[]> {
  const user = await ctx.db.get("SELECT email, email_verified_at FROM users WHERE owner_id = ?", userId) as { email: string; email_verified_at: string | null } | undefined;
  if (!user?.email_verified_at) return [];
  const orgs = await ctx.db.all("SELECT d.org_id, o.handle FROM org_domains d JOIN owners o ON o.id = d.org_id WHERE d.domain = ? AND d.verified_at IS NOT NULL AND d.auto_join = 1", emailDomain(user.email)) as { org_id: number; handle: string }[];
  const joined: string[] = [];
  for (const o of orgs) {
    if (await orgRole(ctx, o.org_id, userId)) continue;
    await addMember(ctx, o.org_id, userId, "Member");
    joined.push(o.handle);
  }
  return joined;
}
