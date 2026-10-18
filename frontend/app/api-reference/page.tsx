import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Braces, KeyRound, ShieldCheck, TriangleAlert, Upload } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { CommandLine } from "@/components/craton-actions";
import { ErrorExample } from "./error-example";
import { Badge } from "@/components/ui/badge";
import { loadOperations, loadWebhookEvents, opKey, type OpDetail } from "@/lib/openapi";

export const metadata: Metadata = {
  alternates: { types: { "text/markdown": "/api-reference.md" } },
  title: "API reference",
  description: "The Craton REST API: repositories, chunked transfer, history, checks, reviews and releases.",
};

type Endpoint = { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string; note: string; auth?: "token" | "write" | "admin" };
type Group = { id: string; title: string; intro: string; endpoints: Endpoint[] };

// Every route in backend/src/api/app.ts, grouped. Paths are relative to /v1.
const groups: Group[] = [
  {
    id: "accounts",
    title: "Accounts and tokens",
    intro: "Sign up or log in for a session token, or create personal access tokens for the CLI and CI.",
    endpoints: [
      { method: "POST", path: "/auth/signup", note: "Create an account; returns a session token." },
      { method: "POST", path: "/auth/login", note: "Log in with a username or email and password. With two-step verification on, returns { mfaRequired, ticket } instead of a token." },
      { method: "POST", path: "/auth/login/2fa", note: "Finish a two-step sign-in: { ticket, code } with an authenticator or recovery code. The ticket lasts 5 minutes and 5 tries." },
      { method: "POST", path: "/auth/logout", note: "End the session making the request." },
      { method: "POST", path: "/auth/forgot", note: "Ask for a password reset email: { login } (a username or an email). Always answers the same, whether or not there is such an account." },
      { method: "POST", path: "/auth/reset", note: "Set a new password with the emailed token: { token, password }. Other sessions are signed out." },
      { method: "POST", path: "/auth/verify", note: "Confirm an email address with the token from the verification email: { token }." },
      { method: "GET", path: "/auth/providers", note: "Which sign-in providers this server offers: { google }. The sign-in page shows only buttons that work." },
      { method: "POST", path: "/auth/passkey/options", note: "Begin signing in with a passkey: returns { challenge, rpId, userVerification, allowCredentials: [] }, so the device offers whichever passkeys it holds for this site. No username needed." },
      { method: "POST", path: "/auth/passkey/login", note: "Finish it: { credential } as the browser returned it (ids and bytes as base64url). The challenge, origin, relying-party hash, user presence, signature and counter are all checked. Answers a session { token }, or { mfaRequired, ticket } when the device did not verify the person and the account has two-step verification." },
      { method: "POST", path: "/auth/{provider}/start", note: "Begin signing in with Google or GitHub (provider is google or github): { next?, link? } returns { url, state }. Send the browser to url. With a session and link: true the Google account is added to that account instead." },
      { method: "POST", path: "/auth/{provider}/callback", note: "Finish it with the { code, state } the provider sent back. Answers a session { token }, { mfaRequired, ticket } for an account with two-step verification, { needsUsername, ticket, suggestion } the first time, or { linked } when it began in Settings. Everything is checked: state, PKCE, the ID token's signature, audience, expiry and nonce, and that Google verified the address." },
      { method: "POST", path: "/auth/{provider}/pending", note: "What the choose-a-username step shows for a ticket: { ticket } gives { email, name, suggestion }." },
      { method: "POST", path: "/auth/{provider}/complete", note: "First sign-in with Google: { ticket, username, name? } creates the account (its address already verified, no password) and starts the session." },
      { method: "POST", path: "/auth/sso/start", note: "Begin signing in through an organization's own provider: { email, next? } returns { url, state }. 404 sso_not_configured when no organization has verified that domain and set up SSO." },
      { method: "POST", path: "/auth/sso/callback", note: "Finish it with the { code, state } the provider sent back to /auth/sso/callback. Same answers as the Google callback. The address must be at a domain the organization has verified (403 domain_not_verified otherwise)." },
      { method: "POST", path: "/auth/sso/pending", note: "What the choose-a-username step shows for a single sign-on ticket: { ticket } gives { email, name, suggestion }." },
      { method: "POST", path: "/auth/sso/complete", note: "First sign-in through SSO: { ticket, username, name? } creates the account (address verified, no password), adds it to the organization and starts the session." },
      { method: "POST", path: "/auth/digest/unsubscribe", note: "The weekly summary email's one-click unsubscribe: { token } from the link in the message turns it off for that account. No sign-in; the token is a keyed signature of the account." },
      { method: "GET", path: "/user", note: "The signed-in user and the owners they can push to.", auth: "token" },
      { method: "GET", path: "/user/identities", note: "How this account signs in: { identities, hasPassword, googleAvailable }. Web sessions only." },
      { method: "POST", path: "/user/passkeys/options", note: "Begin adding a passkey: returns the WebAuthn creation options (challenge, relying party, user handle, accepted algorithms, passkeys to exclude). Web sessions only; 20 requests an hour.", auth: "token" },
      { method: "POST", path: "/user/passkeys", note: "Finish adding one: { credential, name? }. Up to 20 per account. Attestation is not used.", auth: "token" },
      { method: "GET", path: "/user/passkeys", note: "Your passkeys: name, when added and last used, transports, whether it syncs between devices.", auth: "token" },
      { method: "PATCH", path: "/user/passkeys/{id}", note: "Rename one: { name }.", auth: "token" },
      { method: "DELETE", path: "/user/passkeys/{id}", note: "Remove one. Refused while it is the only way into the account.", auth: "token" },
      { method: "DELETE", path: "/user/identities/{provider}", note: "Disconnect Google or GitHub. Refused while it is the only way in (no password, passkey or other provider): add a password first (\"Forgot password\" sets one by email)." },
      { method: "PATCH", path: "/user", note: "Change your profile: { name?, bio?, website?, location?, company?, pronouns?, role?, onboarded?, digest?, notify?, defaultVisibility? }. website is empty or an http(s) address (a bare domain gets https), location and company up to 80 characters, pronouns up to 40; all are public. digest is off or weekly (the optional weekly summary email). notify switches individual emails on or off, e.g. { review_requests: false } (review_requests, checks_failed, repo_access, webhook_paused, storage; all on by default; account-security emails cannot be switched off). defaultVisibility is public or private: what POST /repos uses when the request does not say." },
      { method: "PUT", path: "/user/avatar", note: "Set your profile picture: send a PNG, JPEG or WebP as the request body (at most 512 KB; judged by its bytes, not its content type; SVG is refused). The web app shrinks a chosen picture to 256 px first. Returns your profile with hasAvatar: true." },
      { method: "DELETE", path: "/user/avatar", note: "Remove your profile picture." },
      { method: "GET", path: "/avatars/{handle}", note: "A person's profile picture (revalidated with its ETag on every use, so a new picture shows at once), or 404 when they have none. No sign-in needed." },
      { method: "DELETE", path: "/user", note: "Delete your account: { handle, password }. Your conversations stay as @ghost; blocked while you are the only owner of an organization." },
      { method: "POST", path: "/user/verify/resend", note: "Send the verification email again." },
      { method: "POST", path: "/user/password", note: "Change your password: { current, next }. Other sessions are signed out." },
      { method: "GET", path: "/user/sessions", note: "Browsers and devices you are signed in on, with the one making the request marked." },
      { method: "DELETE", path: "/user/sessions/{id}", note: "Sign one of them out." },
      { method: "GET", path: "/user/export", note: "Everything Craton holds about you, as JSON, without secrets. Web sessions only." },
      { method: "GET", path: "/user/export/repositories", note: "The default branch of every repository you own, as one ZIP (a folder each). Over 4 GB or 65,535 files it refuses and points to the CLI." },
      { method: "GET", path: "/user/onboarding", note: "Your getting-started checklist and which steps are done." },
      { method: "GET", path: "/scopes", note: "The token scopes and what each allows." },
      { method: "GET", path: "/plans", note: "Plan limits (storage, private repositories); null means no limit." },
      { method: "GET", path: "/user/2fa", note: "Whether two-step verification is on, and how many recovery codes are left. Web sessions only." },
      { method: "GET", path: "/user/security-log", note: "Your recent security activity: sign-ins, failed attempts, password and token changes. Web sessions only. ?limit=." },
      { method: "POST", path: "/user/2fa/setup", note: "Start setup with your password: returns the secret and otpauth link to scan. Nothing changes until a code is confirmed." },
      { method: "POST", path: "/user/2fa/enable", note: "Confirm with a code from the app; returns ten recovery codes, shown once." },
      { method: "POST", path: "/user/2fa/disable", note: "Turn it off: { password, code }." },
      { method: "POST", path: "/user/2fa/recovery-codes", note: "Replace the recovery codes: { password, code }." },
      { method: "GET", path: "/user/usage", note: "Stored bytes after deduplication, against the plan limit.", auth: "token" },
      { method: "GET", path: "/user/tokens", note: "Personal access tokens; current marks the one making the request.", auth: "token" },
      { method: "POST", path: "/user/tokens", note: "Create a token. It’s shown once; only its hash is stored.", auth: "token" },
      // body: { note, scopes, expiresInDays, repos: ["owner/name", ...] } limits the token to those repositories
      { method: "DELETE", path: "/user/tokens/{id}", note: "Revoke a token immediately.", auth: "token" },
      { method: "GET", path: "/user/tokens/{id}/requests", note: "The last 100 requests that access token made: method, route, status, milliseconds, time and where from. Never bodies or query strings. Web sessions only.", auth: "token" },
      { method: "GET", path: "/user/audit-log", note: "What others did, or tried and were refused, on your personal repositories. Filters: actor, outcome (done|denied), before, limit; ?format=csv for up to 5,000 entries.", auth: "token" },
    ],
  },
  {
    id: "owners",
    title: "People and organizations",
    intro: "Profiles, organizations and membership. Only owners change roles, and an organization always keeps one owner.",
    endpoints: [
      { method: "GET", path: "/owners/{handle}", note: "A person or organization with its visible repositories." },
      { method: "GET", path: "/owners/{handle}/usage", note: "Storage for one account or organization (members only).", auth: "token" },
      { method: "GET", path: "/owners/{handle}/starred", note: "Repositories that person starred (those you can see)." },
      { method: "POST", path: "/orgs", note: "Create an organization; you become its owner.", auth: "token" },
      { method: "GET", path: "/orgs/{org}/audit-log", note: "Changes made, and attempts refused, under the organization: who, what, which repository, outcome, and whether by token or browser. Owners only. Same filters and CSV as /user/audit-log.", auth: "token" },
            { method: "GET", path: "/orgs/{org}/domains", note: "The organization's domains: verified or not, whether joining by email address is on, and for an unverified one the TXT record to publish. Owners only.", auth: "admin" },
      { method: "POST", path: "/orgs/{org}/domains", note: "Claim a domain: { domain } (a pasted URL or address is cleaned up). Free-mail domains and public suffixes are refused. Answers the record to publish: TXT _craton-challenge.<domain> = craton-verify=<token>.", auth: "admin" },
      { method: "POST", path: "/orgs/{org}/domains/{domain}/verify", note: "Look up that TXT record. 200 with verified: true, or 422 dns_record_missing saying what was found. The first organization to verify a domain holds it.", auth: "admin" },
      { method: "PATCH", path: "/orgs/{org}/domains/{domain}", note: "{ autoJoin: true } lets anyone with a confirmed email address at a verified domain join as a Member (existing people are added at once and counted in joined); false turns it off. Members who joined stay.", auth: "admin" },
      { method: "DELETE", path: "/orgs/{org}/domains/{domain}", note: "Remove the domain. Nobody loses membership.", auth: "admin" },
      { method: "GET", path: "/orgs/{org}/sso", note: "The organization's single sign-on setup: issuer, client id, whether a secret is saved (never the secret), whether it has been tested and is required, the redirect URI to register, and its verified domains. Owners only.", auth: "admin" },
      { method: "PUT", path: "/orgs/{org}/sso", note: "Connect an OpenID Connect provider: { issuer, clientId, clientSecret }. Needs a verified domain. The issuer's /.well-known/openid-configuration is read (public https addresses only) and must name that issuer. The secret may be left out to keep the saved one; a different issuer or client resets tested and required.", auth: "admin" },
      { method: "PATCH", path: "/orgs/{org}/sso", note: "{ enforced: true } requires single sign-on of members with an address at a verified domain (owners exempt, access tokens unaffected). Refused until someone has signed in through it once.", auth: "admin" },
      { method: "DELETE", path: "/orgs/{org}/sso", note: "Remove the setup and the links it made. Accounts stay.", auth: "admin" },
      { method: "GET", path: "/orgs/{org}/saml", note: "The organization's SAML 2.0 single sign-on setup: provider sign-in URL and entity ID, the certificate's fingerprint and expiry (never the certificate), whether it has been tested and is required, and the addresses to give the provider (ACS URL, entity ID, metadata).", auth: "admin" },
      { method: "PUT", path: "/orgs/{org}/saml", note: "Connect a SAML provider: { ssoUrl, entityId, certificate }. Needs a verified domain. The certificate may be PEM or the bare base64 of a .cer file, up to four during a rollover. Changing the provider turns off a requirement.", auth: "admin" },
      { method: "PATCH", path: "/orgs/{org}/saml", note: "{ enforced: true } requires single sign-on of members with an address at a verified domain (owners exempt). Refused until someone has signed in through it.", auth: "admin" },
      { method: "DELETE", path: "/orgs/{org}/saml", note: "Remove the setup and the links it made. Accounts stay.", auth: "admin" },
      { method: "GET", path: "/saml/{org}/metadata", note: "The organization's SAML service-provider metadata (application/samlmetadata+xml), for importing into the identity provider. Public.", auth: "token" },
      { method: "POST", path: "/auth/saml/acs", note: "Where the web app hands over the identity provider's signed answer: { samlResponse, relayState }. Verified (signature, issuer, audience, times, a reply to a request we made, used once) and answered like the OpenID Connect callback.", auth: "token" },
      { method: "GET", path: "/orgs/{org}/scim", note: "Provisioning (SCIM 2.0) for the organization: the base URL to give an identity provider, its tokens (never the token itself), how many people it has provisioned, and the verified domains it may use.", auth: "admin" },
      { method: "POST", path: "/orgs/{org}/scim/tokens", note: "Make a provisioning token: { note }. Needs a verified domain; up to five per organization. The token (scim_...) is in this answer only; it manages this organization's membership and nothing else.", auth: "admin" },
      { method: "DELETE", path: "/orgs/{org}/scim/tokens/{id}", note: "Remove a provisioning token; the provider that held it stops working at once.", auth: "admin" },
      { method: "GET", path: "/scim/v2/{org}/ServiceProviderConfig", note: "SCIM discovery. All /scim/v2 calls take the provisioning token as a Bearer token and answer application/scim+json.", auth: "token" },
      { method: "GET", path: "/scim/v2/{org}/ResourceTypes", note: "SCIM discovery: the User resource.", auth: "token" },
      { method: "GET", path: "/scim/v2/{org}/Schemas", note: "SCIM discovery: the attributes of a User.", auth: "token" },
      { method: "GET", path: "/scim/v2/{org}/Users", note: "The organization's people. filter=userName eq \"x@y.org\" (also externalId, id, emails.value), startIndex from 1, count up to 200.", auth: "token" },
      { method: "POST", path: "/scim/v2/{org}/Users", note: "Provision a person: adds them as a Member, making a verified account without a password if there is none. The address must be at a verified domain; an existing account whose address was never confirmed is refused (409).", auth: "token" },
      { method: "GET", path: "/scim/v2/{org}/Users/{id}", note: "One person, with active: false once they were removed from the organization.", auth: "token" },
      { method: "PUT", path: "/scim/v2/{org}/Users/{id}", note: "Replace: active, externalId and, for accounts the provider made, the display name. The address can not be changed.", auth: "token" },
      { method: "PATCH", path: "/scim/v2/{org}/Users/{id}", note: "Operations on active, externalId, displayName; \"False\" as a string is understood (Entra ID). active: false removes the person from the organization; owners are never removed this way (409).", auth: "token" },
      { method: "DELETE", path: "/scim/v2/{org}/Users/{id}", note: "Remove the person from the organization and forget the provider's record of them. The account stays.", auth: "token" },
      { method: "GET", path: "/scim/v2/{org}/Groups", note: "Always an empty list: groups are not managed here.", auth: "token" },
{ method: "POST", path: "/orgs/{org}/members", note: "Add a member (owners and maintainers).", auth: "token" },
      { method: "PATCH", path: "/orgs/{org}", note: "Change the name or description (owners): { name?, bio? }.", auth: "token" },
      { method: "DELETE", path: "/orgs/{org}", note: "Delete an empty organization: { confirm } is its handle. Web sessions only.", auth: "token" },
      { method: "GET", path: "/orgs/{org}/export/repositories", note: "The default branch of each of its repositories as one ZIP (owners only). Web sessions only." },
      { method: "PATCH", path: "/orgs/{org}/members/{handle}", note: "Change a member’s role (owners).", auth: "token" },
      { method: "DELETE", path: "/orgs/{org}/members/{handle}", note: "Remove a member (owners).", auth: "token" },
    ],
  },
  {
    id: "repositories",
    title: "Repositories",
    intro: "Private repositories you can’t read answer 404, never 403, so their names can’t be probed.",
    endpoints: [
      { method: "GET", path: "/repos", note: "Repositories you can see; filter with ?owner=, ?q=, ?topic=, ?covers=lat,lon (data that includes that place) and ?bbox=west,south,east,north (data that overlaps that box). Each has a footprint: [west, south, east, north] degrees, or null." },
      { method: "PUT", path: "/repos/{owner}/{repo}/star", note: "Star a repository.", auth: "token" },
      { method: "DELETE", path: "/repos/{owner}/{repo}/star", note: "Remove your star.", auth: "token" },
      { method: "GET", path: "/licenses", note: "The licences a repository can declare (SPDX ids)." },
      { method: "POST", path: "/repos", note: "Create a repository for yourself or an organization.", auth: "token" },
      { method: "GET", path: "/repos/{owner}/{repo}", note: "Details, head commit, counts and the README." },
      { method: "PATCH", path: "/repos/{owner}/{repo}", note: "Rename, describe, set licence and topics, protect, or change check settings.", auth: "admin" },
      { method: "DELETE", path: "/repos/{owner}/{repo}", note: "Delete; chunks other repositories use are kept.", auth: "admin" },
      { method: "GET", path: "/repos/{owner}/{repo}/storage", note: "Logical vs stored bytes, savings, and public repositories sharing chunks." },
      { method: "GET", path: "/repos/{owner}/{repo}/citation", note: "APA, BibTeX and CITATION.cff, from the repository’s own CITATION.cff or its real metadata." },
      { method: "GET", path: "/repos/{owner}/{repo}/dataset.jsonld", note: "schema.org Dataset markup (JSON-LD) for a public repository, in the form Google Dataset Search reads. 404 for a private one." },
      { method: "GET", path: "/repos/{owner}/{repo}/audit", note: "Every commit with its Merkle root, per-file inclusion proofs and the ref log." },
    ],
  },
  {
    id: "transfer",
    title: "Chunked transfer",
    intro: "How the CLI pushes and clones. Clients send only what the server is missing; the server recomputes every hash.",
    endpoints: [
      { method: "POST", path: "/repos/{owner}/{repo}/chunks/missing", note: "Which of these chunk hashes do you need? Scoped to what you may see.", auth: "write" },
      { method: "POST", path: "/repos/{owner}/{repo}/chunks", note: "Upload many chunks in one request: frames of a 64-character hash, a 4-byte big-endian payload length, one encoding byte (0 raw, 1 zstd, 2-8 byte-shuffled or delta then zstd) and the payload, up to 1,000 chunks and 16 MB. The server decodes each, checks it against its hash and stores it as sent.", auth: "write" },
      { method: "POST", path: "/repos/{owner}/{repo}/chunks/fetch", note: "Download many chunks in one request: POST {hashes} (up to 500), receive frames in the same layout as the batched upload, in their stored encoding, for as many as fit in about 8 MB; ask again for the rest." },
      { method: "PUT", path: "/repos/{owner}/{repo}/chunks/{hash}", note: "Upload one chunk; its SHA-256 must match {hash}.", auth: "write" },
      { method: "GET", path: "/repos/{owner}/{repo}/chunks/{hash}", note: "Download one chunk, verified on read." },
      { method: "POST", path: "/repos/{owner}/{repo}/objects/missing", note: "Which blob, tree and commit objects do you need?", auth: "write" },
      { method: "POST", path: "/repos/{owner}/{repo}/objects", note: "Register objects. IDs, sizes and Merkle roots are recomputed.", auth: "write" },
      { method: "GET", path: "/repos/{owner}/{repo}/objects/{id}", note: "One object as canonical JSON." },
      { method: "GET", path: "/repos/{owner}/{repo}/manifest/{ref}", note: "A commit’s tree and blobs, for checkout." },
      { method: "GET", path: "/repos/{owner}/{repo}/commit-objects", note: "Commit objects reachable from ?ref=, for clone and pull." },
    ],
  },
  {
    id: "history",
    title: "Branches and history",
    intro: "History is append-only: a branch moves only by fast-forward, and only if it’s still where you last saw it.",
    endpoints: [
      { method: "GET", path: "/repos/{owner}/{repo}/refs", note: "Branch and tag tips." },
      { method: "POST", path: "/repos/{owner}/{repo}/refs/heads/{branch}", note: "Move a branch: { commit, expected }. Runs checks on the new tip. The new commits are read for credentials first and refused with 422 secret_detected (file, line and kind, never the secret); an administrator can add { allowSecrets: \"reason\" } to push anyway, which is written to the audit log.", auth: "write" },
      { method: "GET", path: "/repos/{owner}/{repo}/branches", note: "Branches with ahead/behind counts against the default branch." },
      { method: "POST", path: "/repos/{owner}/{repo}/branches", note: "Create a branch: { name, from }.", auth: "write" },
      { method: "DELETE", path: "/repos/{owner}/{repo}/branches/{name}", note: "Delete a branch pointer; commits stay.", auth: "write" },
      { method: "GET", path: "/repos/{owner}/{repo}/commits", note: "Commits on ?ref=; ?changes=1 adds changed files with chunk maps." },
      { method: "GET", path: "/repos/{owner}/{repo}/commits/{sha}", note: "One commit with per-file chunk changes and its check run." },
      { method: "GET", path: "/repos/{owner}/{repo}/compare/{base}...{head}", note: "Commits ahead, file changes since the merge base, conflicting paths." },
    ],
  },
  {
    id: "files",
    title: "Files",
    intro: "Browse and read files at any branch or commit.",
    endpoints: [
      { method: "GET", path: "/repos/{owner}/{repo}/tree/{ref}", note: "A folder listing (?path=) with the last commit to touch each entry." },
      { method: "GET", path: "/repos/{owner}/{repo}/file/{ref}/{path}", note: "GeoTIFF tags, shapefile header, table shape, preview, chunks and history." },
      { method: "GET", path: "/repos/{owner}/{repo}/render/{ref}/{path}", note: "A GeoTIFF as a hillshade PNG, a shapefile as SVG, or an uncompressed LAS point cloud as a PNG seen from above (coloured by elevation, faded where points are few; drawn from an evenly spaced sample of at most about 64 MB of a larger file, and the answer says how much was read). ?base=<ref> draws the change from that version; ?size= is the longest side in pixels (64 to 1024). Cached by content." },
      { method: "GET", path: "/repos/{owner}/{repo}/tileinfo/{ref}/{path}", note: "How to lay a GeoTIFF out for zooming: size in pixels, tile size (256), the deepest zoom, the elevation range the colours span, cell size and how many overview levels the file has.", auth: "token" },
      { method: "GET", path: "/repos/{owner}/{repo}/tiles/{ref}/{z}/{x}/{y}/{path}", note: "A 256-pixel PNG tile of a GeoTIFF in the image's own pixel space (zoom 0 is the whole image; the deepest zoom is one tile pixel per image pixel), hillshaded and tinted. Drawn from the nearest overview, so a Cloud Optimized GeoTIFF reads little when zoomed out; 415 when an area would need too many blocks of a file without overviews. ETag, and cached for a year when pinned to a commit.", auth: "token" },
      { method: "POST", path: "/repos/{owner}/{repo}/restore", note: "Put one file back to an earlier version as a new commit: { path, from, branch?, message? }. History is never rewritten.", auth: "write" },
      { method: "GET", path: "/repos/{owner}/{repo}/raw/{ref}/{path}", note: "File bytes, streamed whatever the size. Supports a single Range: bytes=a-b request (206 with Content-Range; up to 64 MB per request), so a client can read part of a large raster." },
      { method: "GET", path: "/repos/{owner}/{repo}/table-diff/{ref}/{path}", note: "A CSV compared with another version (?base=): rows added, removed and changed cell by cell, matched by a key." },
      { method: "POST", path: "/repos/{owner}/{repo}/upload", note: "Add files from the browser: multipart `file` parts with a matching JSON `paths` list, plus folder, branch, from, expected and message. One commit; locks, plan limits and the branch-moved check apply. Files are read for credentials first (422 secret_detected); an administrator can add an `allowSecrets` reason field to go ahead. Up to 100 MB and 200 files.", auth: "write" },
      { method: "GET", path: "/repos/{owner}/{repo}/paths/{ref}", note: "Every file path with its size, for file finders." },
      { method: "GET", path: "/repos/{owner}/{repo}/archive/{ref}", note: "The repository (or ?path=<folder>) as a ZIP, streamed. Over 4 GB, use the CLI." },
    ],
  },
  {
    id: "locks",
    title: "File locks",
    intro: "For files that can’t be merged. One holder per path; a push or merge that changes a path locked by someone else is refused with 409 locked.",
    endpoints: [
      { method: "GET", path: "/repos/{owner}/{repo}/locks", note: "Who holds which path, and why." },
      { method: "POST", path: "/repos/{owner}/{repo}/locks", note: "Lock a path: { path, reason }. Locking what you already hold is a no-op.", auth: "write" },
      { method: "DELETE", path: "/repos/{owner}/{repo}/locks/{path}", note: "Release your lock; ?force=true releases someone else’s.", auth: "write" },
    ],
  },
  {
    id: "sharing",
    title: "Share links",
    intro: "A read-only snapshot for someone without an account. The token is the credential: only its hash is stored, it expires, and an unknown, expired or switched-off token all answer 404. Shared endpoints never cache.",
    endpoints: [
      { method: "GET", path: "/repos/{owner}/{repo}/share-links", note: "Your links and how often each was opened. The addresses aren’t listed: they are shown once, when made.", auth: "admin" },
      { method: "POST", path: "/repos/{owner}/{repo}/share-links", note: "Make one: { ref, expiresInDays: 1|7|30|90, note }. The URL is in this response only.", auth: "admin" },
      { method: "DELETE", path: "/repos/{owner}/{repo}/share-links/{id}", note: "Switch it off now.", auth: "admin" },
      { method: "GET", path: "/shared/{token}", note: "What the link shows: repository, snapshot commit, note, expiry and the file list. No sign-in." },
      { method: "GET", path: "/shared/{token}/file/{path}", note: "One file, streamed, with its SHA-256 in X-Craton-SHA256." },
      { method: "GET", path: "/shared/{token}/archive", note: "The snapshot (or ?path=<folder>) as a ZIP." },
      { method: "GET", path: "/shared/{token}/render/{path}", note: "A map preview of a raster or shapefile in the snapshot." },
    ],
  },
  {
    id: "webhooks",
    title: "Webhooks",
    intro: "A signed POST for push, pull_request, release, issue and lock events, retried with backoff. Signed per the Standard Webhooks scheme: HMAC-SHA256 over webhook-id.webhook-timestamp.body. Destinations must be public https URLs. WEBHOOKS.md in the repository has receiver snippets in Node.js and Python, and `craton webhook verify` checks one delivery from the command line.",
    endpoints: [
      { method: "GET", path: "/webhook-events", note: "What each event carries in `data`, field by field." },
      { method: "GET", path: "/repos/{owner}/{repo}/webhooks", note: "Webhooks and the events you can subscribe to. Secrets are never listed.", auth: "admin" },
      { method: "POST", path: "/repos/{owner}/{repo}/webhooks", note: "Add one: { url, events, format? }. format is auto (the default: a Slack, Teams or Discord address is recognised), json, slack, teams or discord. The signing secret of a json webhook is in this response only; chat webhooks have none.", auth: "admin" },
      { method: "PATCH", path: "/repos/{owner}/{repo}/webhooks/{id}", note: "Change the URL, events or format, or pause it with { active: false }. Resuming clears pausedReason; Craton itself pauses a webhook after ten failed deliveries in a row and emails the admins.", auth: "admin" },
      { method: "DELETE", path: "/repos/{owner}/{repo}/webhooks/{id}", note: "Remove it and its delivery log.", auth: "admin" },
      { method: "GET", path: "/repos/{owner}/{repo}/webhooks/{id}/deliveries", note: "The last 50 deliveries: status, attempts, response code, error.", auth: "admin" },
      { method: "POST", path: "/repos/{owner}/{repo}/webhooks/{id}/ping", note: "Send a test event.", auth: "admin" },
      { method: "POST", path: "/repos/{owner}/{repo}/webhooks/{id}/deliveries/{delivery}/redeliver", note: "Send a delivery again with its original message id.", auth: "admin" },
    ],
  },
  {
    id: "collaboration",
    title: "Checks, reviews and releases",
    intro: "Checks run on every push. With branch protection on, failing checks or a missing approval block the merge.",
    endpoints: [
      { method: "GET", path: "/repos/{owner}/{repo}/checks", note: "Check runs: CRS, vertical datum, nodata, Cloud Optimized GeoTIFF layout, shapefile sets, HEC-RAS model schema, SWMM models, point clouds, integrity." },
      { method: "GET", path: "/repos/{owner}/{repo}/raster-stats/{ref}/{path}", note: "Numbers behind a raster change: summary of each version, a shared histogram, mean change, RMSE, area raised and lowered, volume. ?base=<ref> required." },
      { method: "GET", path: "/repos/{owner}/{repo}/badge/checks.svg", note: "Status badge of the default branch's latest check run. Public repositories only." },
      { method: "GET", path: "/repos/{owner}/{repo}/badge/{release|size|license}.svg", note: "Badges for the latest release, the stored size and the licence. Public repositories only." },
      { method: "GET", path: "/repos/{owner}/{repo}/issues", note: "Issues; filter with ?state= and ?label=." },
      { method: "POST", path: "/repos/{owner}/{repo}/issues", note: "Open an issue, optionally tied to a file. Choosing a milestone needs write access.", auth: "token" },
      { method: "GET", path: "/repos/{owner}/{repo}/issues/{n}", note: "An issue with its comments." },
      { method: "PATCH", path: "/repos/{owner}/{repo}/issues/{n}", note: "Close, reopen, relabel, reassign or set the milestone.", auth: "write" },
      { method: "POST", path: "/repos/{owner}/{repo}/issues/{n}/comments", note: "Comment on an issue.", auth: "token" },
      { method: "GET", path: "/repos/{owner}/{repo}/collaborators", note: "People invited to this repository, with roles.", auth: "write" },
      { method: "PUT", path: "/repos/{owner}/{repo}/collaborators/{handle}", note: "Add someone or change their role: { role: Read | Write | Admin }. They are told by email.", auth: "admin" },
      { method: "DELETE", path: "/repos/{owner}/{repo}/collaborators/{handle}", note: "Remove someone (or leave yourself).", auth: "admin" },
      { method: "POST", path: "/repos/{owner}/{repo}/invites", note: "Invite by email address: { email, role }. An address with an account is added at once; otherwise a one-time link is emailed.", auth: "admin" },
      { method: "GET", path: "/repos/{owner}/{repo}/invites", note: "Invitations waiting for a reply.", auth: "admin" },
      { method: "DELETE", path: "/repos/{owner}/{repo}/invites/{id}", note: "Withdraw an invitation.", auth: "admin" },
      { method: "GET", path: "/invites/{token}", note: "What an invitation is for (repository, role, who invited), before signing in." },
      { method: "POST", path: "/invites/accept", note: "Accept: { token }. The signed-in account must have confirmed the invited address.", auth: "token" },
      { method: "GET", path: "/user/shared", note: "Repositories other people shared with you.", auth: "token" },
      { method: "GET", path: "/repos/{owner}/{repo}/templates", note: "Issue templates (.craton-templates/issue/*.md) and the pull request template (.craton-templates/pull_request.md), read from the default branch." },
      { method: "GET", path: "/repos/{owner}/{repo}/milestones", note: "Milestones with open and closed issue counts; open ones first, by due date." },
      { method: "POST", path: "/repos/{owner}/{repo}/milestones", note: "Create one: { title, description?, due? (YYYY-MM-DD) }.", auth: "write" },
      { method: "PATCH", path: "/repos/{owner}/{repo}/milestones/{id}", note: "Rename (issues follow), change the date, close or reopen.", auth: "write" },
      { method: "GET", path: "/model-review-template", note: "The default model review checklist: id and the items, each with group, wording, a hint and where the wording comes from." },
      { method: "GET", path: "/repos/{owner}/{repo}/model-reviews", note: "Model reviews of this repository, newest first, with item counts and the last decision." },
      { method: "GET", path: "/repos/{owner}/{repo}/audit-log", note: "The same log for one repository. Admins only.", auth: "admin" },
      { method: "POST", path: "/repos/{owner}/{repo}/model-reviews", note: "Open a review pinned to a commit: { title, ref? } (default branch). Captures the gate's findings and each HEC-RAS plan's run summary as evidence.", auth: "write" },
      { method: "GET", path: "/repos/{owner}/{repo}/model-reviews/{n}", note: "One review: the pinned commit and Merkle root, the checklist with suggestions drawn from evidence, the modelling log, sign-offs and evidence." },
      { method: "PUT", path: "/repos/{owner}/{repo}/model-reviews/{n}/items/{key}", note: "Mark one checklist item: { status: todo|pass|fail|na, note? }. Locked once approved.", auth: "write" },
      { method: "POST", path: "/repos/{owner}/{repo}/model-reviews/{n}/log", note: "Append to the modelling log: { body }. Entries are never edited or removed.", auth: "write" },
      { method: "POST", path: "/repos/{owner}/{repo}/model-reviews/{n}/evidence", note: "Capture the findings again, optionally re-pinning to another ref: { ref? }. Not possible once approved.", auth: "write" },
      { method: "POST", path: "/repos/{owner}/{repo}/model-reviews/{n}/submit", note: "Send the review for decision.", auth: "write" },
      { method: "POST", path: "/repos/{owner}/{repo}/model-reviews/{n}/decision", note: "Approve or ask for changes: { decision: approve|request_changes, comment? }. Approval needs every item marked and every failed item explained; whether the reviewer is the author is recorded.", auth: "write" },
      { method: "POST", path: "/repos/{owner}/{repo}/model-reviews/{n}/reopen", note: "Reopen an approved review as a draft: { reason }.", auth: "write" },
      { method: "DELETE", path: "/repos/{owner}/{repo}/model-reviews/{n}", note: "Delete a review that is not approved.", auth: "admin" },
      { method: "GET", path: "/repos/{owner}/{repo}/model-reviews/{n}/export", note: "The review as Markdown to attach to a submission (?download=1 for a file)." },
      { method: "DELETE", path: "/repos/{owner}/{repo}/milestones/{id}", note: "Delete; its issues stay and lose the milestone.", auth: "write" },
      { method: "GET", path: "/repos/{owner}/{repo}/pulls", note: "Pull requests with check status and approvals of the current head." },
      { method: "POST", path: "/repos/{owner}/{repo}/pulls", note: "Open a pull request: { title, body, source, target }.", auth: "write" },
      { method: "GET", path: "/repos/{owner}/{repo}/pulls/{n}", note: "A pull request with reviews and comments." },
      { method: "POST", path: "/repos/{owner}/{repo}/pulls/{n}/comments", note: "Comment on a pull request.", auth: "token" },
      { method: "PATCH", path: "/repos/{owner}/{repo}/comments/{id}", note: "Edit your own comment (on an issue or a pull request; they share ids): { body }. The comment then carries editedAt.", auth: "token" },
      { method: "DELETE", path: "/repos/{owner}/{repo}/comments/{id}", note: "Delete a comment: its author, or anyone who administers the repository. Its reactions go with it.", auth: "token" },
      { method: "PUT", path: "/repos/{owner}/{repo}/comments/{id}/reactions/{emoji}", note: "React to a comment: thumbs_up, thumbs_down, laugh, hooray, confused, heart, rocket or eyes. One per person per emoji; asking twice changes nothing. Returns the comment with its reactions: { emoji: { count, mine, by } } (by lists up to ten handles).", auth: "token" },
      { method: "DELETE", path: "/repos/{owner}/{repo}/comments/{id}/reactions/{emoji}", note: "Take your reaction back.", auth: "token" },
      { method: "POST", path: "/repos/{owner}/{repo}/pulls/{n}/reviews", note: "Approve, request changes or comment. Not on your own.", auth: "write" },
      { method: "POST", path: "/repos/{owner}/{repo}/pulls/{n}/merge", note: "Fast-forward or three-way merge; conflicts and failing checks refuse.", auth: "write" },
      { method: "POST", path: "/repos/{owner}/{repo}/pulls/{n}/close", note: "Close without merging.", auth: "write" },
      { method: "POST", path: "/repos/{owner}/{repo}/pulls/{n}/review-requests", note: "Ask a specific person to review: { handle }. They are emailed and it waits in their inbox.", auth: "write" },
      { method: "DELETE", path: "/repos/{owner}/{repo}/pulls/{n}/review-requests/{handle}", note: "Withdraw the request.", auth: "write" },
      { method: "GET", path: "/repos/{owner}/{repo}/releases", note: "Releases with pinned per-file SHA-256 and Merkle root." },
      { method: "POST", path: "/repos/{owner}/{repo}/releases", note: "Publish a release; every file is re-hashed first. { tag, target?, title?, notes?, prerelease?, run? }. run says which model run it came from, all optional: { software, version, plan, runtimeSeconds, completedAt, notes, inputs: [{ repo: \"owner/name\", commit, note? }] } (unknown fields are refused). It is returned with the release and carried into its STAC collection as craton:run.", auth: "write" },
      { method: "GET", path: "/repos/{owner}/{repo}/releases/{tag}/SHA256SUMS", note: "Checksums in sha256sum format." },
      { method: "GET", path: "/repos/{owner}/{repo}/text-diff/{ref}/{path}", note: "Line diff of a text file against ?base=<ref>: hunks with three lines of context. 415 for binaries and very large files." },
      { method: "GET", path: "/repos/{owner}/{repo}/blame/{ref}/{path}", note: "Which commit last rewrote each byte range of a file (by chunk), up to 500 commits back." },
      { method: "POST", path: "/repos/{owner}/{repo}/owners/preview", note: "What a CODEOWNERS text would do: files per person, unknown names, files nobody owns.", auth: "write" },
      { method: "GET", path: "/repos/{owner}/{repo}/pulls/{number}/owners", note: "Owners of the changed files from CODEOWNERS on the target branch, with their files and review state." },
      { method: "GET", path: "/repos/{owner}/{repo}/releases/{tag}/stac/collection.json", note: "The release as a STAC 1.0.0 Collection: licence, real extent, Merkle root." },
      { method: "GET", path: "/repos/{owner}/{repo}/releases/{tag}/stac/items.json", note: "One STAC Item per file with its box and a sha-256 file:checksum." },
    ],
  },
  {
    id: "discovery",
    title: "Search and activity",
    intro: "Everything here covers only repositories the caller can read.",
    endpoints: [
      { method: "GET", path: "/search", note: "Repositories, file paths, people and organizations matching ?q=." },
      { method: "GET", path: "/trending", note: "Public repositories ranked by recent stars. ?period=day|week|month." },
      { method: "GET", path: "/readme-templates", note: "The README starters for new repositories (HEC-RAS model, DEM survey, gauges, and others)." },
      { method: "GET", path: "/user/starred", note: "Repositories you starred." },
      { method: "GET", path: "/activity", note: "Pushes, branches, pull requests, reviews, issues, comments, releases. ?actor= filters." },
      { method: "GET", path: "/repos/{owner}/{repo}/activity", note: "The same feed for one repository." },
      { method: "GET", path: "/user/inbox", note: "Your inbox: activity that concerns you, with read and done state. ?view=inbox|done|all, ?limit=." },
      { method: "GET", path: "/user/filters", note: "Your saved issue and pull request filters. ?kind=issues|pulls.", auth: "token" },
      { method: "POST", path: "/user/filters", note: "Save one: { kind, name, state, label, q }. Same name replaces.", auth: "token" },
      { method: "DELETE", path: "/user/filters/{id}", note: "Delete a saved filter.", auth: "token" },
      { method: "GET", path: "/user/inbox/count", note: "Just the unread count, for a badge." },
      { method: "POST", path: "/user/inbox/{read|unread|done|restore}", note: "Body { keys: [...] }, up to 200. Answers { unread }." },
      { method: "POST", path: "/user/inbox/read-all", note: "Mark everything up to now as read." },
      { method: "GET", path: "/issues", note: "Issues across every repository you can see, with a repo field." },
      { method: "GET", path: "/pulls", note: "Pull requests across every repository you can see." },
      { method: "GET", path: "/health", note: "Liveness and which chunk store is in use (local disk or R2)." },
    ],
  },
];

const authLabel = { token: "Token", write: "Write access", admin: "Admin" } as const;

const pushSteps = [
  { step: "Chunk", body: "Split each file with FastCDC (32 KB minimum, 128 KB average, 512 KB maximum) and hash every chunk with SHA-256." },
  { step: "Negotiate", body: "POST the hashes to chunks/missing. The answer only covers chunks you’re allowed to see: public ones, and your own owner’s." },
  { step: "Upload", body: "PUT each missing chunk, or POST many small ones together to chunks (up to 1,000 per request). The server verifies every hash and compresses losslessly with zstd, keeping the result only if it round-trips." },
  { step: "Register", body: "POST the blob, tree and commit objects. The server recomputes their IDs, sizes and the commit’s Merkle root, and refuses any chunk it doesn’t have." },
  { step: "Move the branch", body: "POST refs/heads/{branch} with the new commit and the tip you expect. A stale expected tip or a non-fast-forward is rejected. Checks run on the new tip." },
];

/** Query parameters and request body of an endpoint, from the API's OpenAPI document, folded away until asked for. */
function EndpointDetail({ detail }: { detail?: OpDetail }) {
  if (!detail || (detail.params.length === 0 && !detail.body)) return null;
  return (
    <details className="w-full basis-full text-xs lg:pl-[calc(3.5rem+1rem)]">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        {detail.params.length > 0 && `${detail.params.length} query ${detail.params.length === 1 ? "parameter" : "parameters"}`}
        {detail.params.length > 0 && detail.body && " · "}
        {detail.body && "request body"}
      </summary>
      <div className="mt-2 flex flex-col gap-3 border-l border-border pl-3">
        {detail.params.length > 0 && (
          <ul className="flex flex-col gap-1">
            {detail.params.map((p) => (
              <li key={p.name}>
                <code className="font-mono">?{p.name}</code>
                {p.required && <span className="text-muted-foreground"> (required)</span>}
                {p.description && <span className="text-muted-foreground">: {p.description}</span>}
              </li>
            ))}
          </ul>
        )}
        {detail.body && (
          <div className="flex flex-col gap-2">
            <ul className="flex flex-col gap-1">
              {detail.body.fields.map((f) => (
                <li key={f.name}>
                  <code className="font-mono">{f.name}</code> <span className="text-muted-foreground">{f.type}{f.required ? ", required" : ""}{f.description ? `: ${f.description}` : ""}</span>
                </li>
              ))}
            </ul>
            {detail.body.example !== undefined && <pre className="overflow-x-auto border border-border bg-muted/30 p-2 font-mono">{JSON.stringify(detail.body.example, null, 2)}</pre>}
          </div>
        )}
      </div>
    </details>
  );
}

const methodStyle: Record<Endpoint["method"], string> = {
  GET: "text-foreground",
  POST: "text-chart-1",
  PUT: "text-chart-1",
  PATCH: "text-chart-2",
  DELETE: "text-destructive",
};

export default async function ApiReferencePage() {
  const [operations, webhookEvents] = await Promise.all([loadOperations(), loadWebhookEvents()]);
  const total = groups.reduce((n, g) => n + g.endpoints.length, 0);
  return (
    <AppShell>
      <div className="grid grid-cols-1 w-full gap-8 px-4 sm:px-6 lg:px-8 xl:px-10 py-8 md:grid-cols-[220px_1fr]">
        <aside className="hidden md:block">
          <nav aria-label="On this page" className="sticky top-20 flex flex-col text-[15px]">
            <Link href="#authentication" className="py-2 text-muted-foreground transition-colors hover:text-foreground">Authentication</Link>
            <Link href="#push" className="py-2 text-muted-foreground transition-colors hover:text-foreground">How a push works</Link>
            <Link href="#errors" className="py-2 text-muted-foreground transition-colors hover:text-foreground">Errors</Link>
            {Object.keys(webhookEvents).length > 0 && <Link href="#webhook-events" className="py-2 text-muted-foreground transition-colors hover:text-foreground">Webhook events</Link>}
            <Link href="#tools" className="py-2 text-muted-foreground transition-colors hover:text-foreground">Terminal and assistants</Link>
            {Object.keys(webhookEvents).length > 0 && (
            <section id="webhook-events" className="mt-10 scroll-mt-20 border-t border-border pt-6">
              <h2 className="text-lg font-semibold">Webhook events</h2>
              <p className="mt-2 text-sm text-muted-foreground text-pretty">
                Every delivery is a JSON object with <code className="font-mono text-foreground">id</code>, <code className="font-mono text-foreground">type</code>,{" "}
                <code className="font-mono text-foreground">createdAt</code>, <code className="font-mono text-foreground">repository</code> (owner, name, visibility) and{" "}
                <code className="font-mono text-foreground">data</code>, whose fields are below. Fields marked optional appear only for some actions.
              </p>
              <div className="mt-4 flex flex-col gap-4">
                {Object.entries(webhookEvents).map(([event, doc]) => (
                  <div key={event} className="border border-border bg-card p-4">
                    <h3 className="font-mono text-sm font-semibold">{event}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{doc.when}</p>
                    <ul className="mt-3 flex flex-col gap-1 text-xs">
                      {Object.entries(doc.fields).map(([field, about]) => (
                        <li key={field}>
                          <code className="font-mono">{field}</code>
                          {doc.optional?.includes(field) && <span className="text-muted-foreground"> (optional)</span>}
                          <span className="text-muted-foreground">: {about}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          {groups.map((g) => (
              <Link key={g.id} href={`#${g.id}`} className="py-2 text-muted-foreground transition-colors hover:text-foreground">
                {g.title}
              </Link>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 max-w-4xl">
          <Badge variant="outline">Reference · v1</Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Craton API</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground text-pretty">
            The same API the web app and the CLI use: {total} endpoints under <code className="font-mono text-foreground">/v1</code>. JSON in and out, except chunk and raw file bodies.
          </p>

          <section id="authentication" className="mt-10 scroll-mt-20 border-t border-border pt-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <KeyRound className="size-4 text-muted-foreground" aria-hidden />
              Authentication
            </h2>
            <p className="mt-2 text-sm text-muted-foreground text-pretty">
              Send a <Link href="/settings/tokens" className="text-foreground underline underline-offset-2">personal access token</Link> as a bearer token. Public repositories can be read without one.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <CommandLine command='curl -H "Authorization: Bearer crt_pat_…" http://localhost:4000/v1/user' />
              <CommandLine command="curl http://localhost:4000/v1/repos/hydrolab/chalakudy-basin/compare/main...levee-scenario" />
            </div>
          </section>

          <section id="push" className="mt-10 scroll-mt-20 border-t border-border pt-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Upload className="size-4 text-muted-foreground" aria-hidden />
              How a push works
            </h2>
            <ol className="mt-4 flex flex-col divide-y divide-border border border-border bg-card">
              {pushSteps.map((s, i) => (
                <li key={s.step} className="flex gap-4 px-4 py-3">
                  <span className="w-5 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <div>
                    <p className="text-sm font-medium">{s.step}</p>
                    <p className="text-xs text-muted-foreground text-pretty">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground text-pretty">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Uploading a chunk that exists privately elsewhere still requires sending its bytes, which proves you have them. It’s then stored once, physically.
            </p>
          </section>

          <section id="errors" className="mt-10 scroll-mt-20 border-t border-border pt-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <TriangleAlert className="size-4 text-muted-foreground" aria-hidden />
              Errors
            </h2>
            <p className="mt-2 text-sm text-muted-foreground text-pretty">
              Every error has the same shape. <code className="font-mono text-foreground">code</code> is stable; <code className="font-mono text-foreground">message</code> is written for people.
            </p>
            <ErrorExample />
            <p className="mt-2 text-xs text-muted-foreground">
              Common codes: <code className="font-mono">unauthenticated</code> 401, <code className="font-mono">forbidden</code> 403, <code className="font-mono">not_found</code> 404,{" "}
              <code className="font-mono">non_fast_forward</code>, <code className="font-mono">stale_ref</code>, <code className="font-mono">merge_conflict</code>, <code className="font-mono">last_owner</code> 409.
            </p>
          </section>

          <section id="tools" className="mt-10 scroll-mt-20 border-t border-border pt-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Bot className="size-4 text-muted-foreground" aria-hidden />
              Terminal and assistants
            </h2>
            <p className="mt-2 text-sm text-muted-foreground text-pretty">
              The numbers behind a change are available without the browser. <code className="font-mono text-foreground">craton diff</code> lists the files that differ between two versions and how many chunks were rewritten, from local history. <code className="font-mono text-foreground">craton stats</code> prints raster statistics and the change against an earlier version, or the fit of a simulated column against an observed one, per station if you name a station column. Add <code className="font-mono text-foreground">--json</code> for scripts. The API itself is described, from its real route table, at <code className="font-mono text-foreground">/v1/openapi.json</code> (OpenAPI 3.1: paths, methods, parameters, bearer auth and the error shape).
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <CommandLine command="craton diff v1.0.0" />
              <CommandLine command="craton stats terrain/basin_dem.tif --base v1.0.0" />
              <CommandLine command="craton stats gauges.csv --obs stage_m --sim stage_model --by station" />
            </div>
            <p className="mt-4 text-sm text-muted-foreground text-pretty">
              A Python client is one file with no dependencies, <code className="font-mono text-foreground">sdk/python/craton.py</code>: <code className="font-mono text-foreground">Craton(server, token).repo(owner, name)</code> then <code className="font-mono text-foreground">.releases()</code>, <code className="font-mono text-foreground">.table(path)</code>, <code className="font-mono text-foreground">.read(path)</code>, <code className="font-mono text-foreground">.compare(a, b)</code> and <code className="font-mono text-foreground">.raster_stats(path, base)</code>. It reads, creates issues and releases and takes locks; files themselves go through the CLI.
            </p>
            <p className="mt-4 text-sm text-muted-foreground text-pretty">
              An MCP server lets an assistant answer questions such as what changed in the DEM since the last release. It is read only, talks over stdio, and uses the same token as the API, so it sees what you can see.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <CommandLine command="npm run mcp --prefix backend" />
            </div>
            <pre className="mt-3 overflow-x-auto border border-border bg-card p-3 font-mono text-xs leading-relaxed">{`{
  "mcpServers": {
    "craton": {
      "command": "node",
      "args": ["--disable-warning=ExperimentalWarning", "<path>/backend/src/mcp/server.ts"],
      "env": { "CRATON_SERVER": "http://localhost:4000", "CRATON_TOKEN": "crt_pat_…" }
    }
  }
}`}</pre>
            <p className="mt-2 text-xs text-muted-foreground text-pretty">
              Tools: <code className="font-mono">craton_what_changed</code> (latest release to the default branch unless you say otherwise), <code className="font-mono">craton_list_releases</code>, <code className="font-mono">craton_list_files</code>, <code className="font-mono">craton_table_fit</code> (NSE, KGE and PBIAS of a gauge table, per station), <code className="font-mono">craton_blame</code> (which commit changed which part of a file), <code className="font-mono">craton_text_diff</code> (the changed lines of a plan or config), <code className="font-mono">craton_pull_owners</code> (who must review a pull request) and <code className="font-mono">craton_raster_stats</code>.
            </p>
          </section>

          {groups.map((g) => (
            <section key={g.id} id={g.id} className="mt-10 scroll-mt-20 border-t border-border pt-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Braces className="size-4 text-muted-foreground" aria-hidden />
                {g.title}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground text-pretty">{g.intro}</p>
              <ul className="mt-4 flex flex-col divide-y divide-border border border-border bg-card">
                {g.endpoints.map((e) => (
                  <li key={`${e.method} ${e.path}`} className="flex flex-col gap-1 px-4 py-3 lg:flex-row lg:items-center lg:gap-4">
                    <span className={`w-14 shrink-0 font-mono text-xs font-semibold ${methodStyle[e.method]}`}>{e.method}</span>
                    <code className="min-w-0 break-all font-mono text-xs text-foreground lg:w-104 lg:shrink-0">{e.path}</code>
                    <span className="flex-1 text-xs text-muted-foreground text-pretty">{e.note}</span>
                    {e.auth && (
                      <Badge variant="outline" className="w-fit shrink-0 text-[10px]">
                        {authLabel[e.auth]}
                      </Badge>
                    )}
                    <EndpointDetail detail={operations.get(opKey(e.method, e.path))} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
