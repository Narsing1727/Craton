// Transactional email: verify address, password reset, organization invite.
// Every message has a plain-text body (accessibility and deliverability) and a simple HTML body.
// Without an API key, messages go to data/outbox/ as JSON and a line in the log, so development
// and tests exercise the same code path as production.

import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";

export type Email = { to: string; subject: string; text: string; html: string; kind: string };

/** Messages sent by this process, newest last (read by tests and the dev outbox endpoint). */
export const sentEmails: (Email & { at: string })[] = [];

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** One layout for every message: short, plain, a single clear button, no tracking pixels. */
function layout(heading: string, paragraphs: string[], action?: { label: string; url: string }, footer = "You're receiving this because of activity on your Craton account.") {
  const text = [heading, "", ...paragraphs.flatMap((p) => [p, ""]), ...(action ? [`${action.label}: ${action.url}`, ""] : []), "—", footer].join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">
<div style="max-width:520px;margin:0 auto">
<p style="font-weight:700;font-size:15px;margin:0 0 24px">Craton</p>
<h1 style="font-size:20px;margin:0 0 16px">${escape(heading)}</h1>
${paragraphs.map((p) => `<p style="font-size:14px;line-height:1.6;margin:0 0 12px">${escape(p)}</p>`).join("\n")}
${action ? `<p style="margin:24px 0"><a href="${escape(action.url)}" style="background:#111;color:#fff;padding:10px 16px;text-decoration:none;font-size:14px;font-weight:600">${escape(action.label)}</a></p><p style="font-size:12px;color:#666;word-break:break-all">${escape(action.url)}</p>` : ""}
<p style="font-size:12px;color:#666;margin-top:32px;border-top:1px solid #eee;padding-top:12px">${escape(footer)}</p>
</div></body></html>`;
  return { text, html };
}

async function deliver(email: Email) {
  sentEmails.push({ ...email, at: new Date().toISOString() });
  if (sentEmails.length > 200) sentEmails.shift();

  if (!config.email.apiKey) {
    const inTests = Boolean(process.env.NODE_TEST_CONTEXT);
    if (!inTests) {
      try {
        const dir = path.join(config.dataDir, "outbox");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${Date.now()}-${email.kind}.json`), JSON.stringify(email, null, 2));
      } catch {}
    }
    if (!inTests) console.log(`[email → ${email.to}] ${email.subject}\n${email.text.split("\n").find((l) => l.startsWith("http") || l.includes(": http")) ?? ""}`);
    return;
  }
  try {
    const res =
      config.email.provider === "postmark"
        ? await fetch("https://api.postmarkapp.com/email", {
            method: "POST",
            headers: { "X-Postmark-Server-Token": config.email.apiKey, "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ From: config.email.from, To: email.to, Subject: email.subject, TextBody: email.text, HtmlBody: email.html, MessageStream: "outbound" }),
          })
        : await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { authorization: `Bearer ${config.email.apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({ from: config.email.from, to: [email.to], subject: email.subject, text: email.text, html: email.html }),
          });
    if (!res.ok) console.error(`Email to ${email.to} failed: ${res.status} ${await res.text()}`);
  } catch (err) {
    // Email must never take a request down with it; the user can ask for another link.
    console.error(`Email to ${email.to} failed:`, err);
  }
}

export function sendVerifyEmail(to: string, name: string, url: string) {
  const { text, html } = layout(
    "Confirm your email address",
    [`Hi ${name}, confirm this is your address so you can publish repositories and invite teammates.`, "The link works once and expires in 24 hours."],
    { label: "Confirm email address", url },
    "If you didn't create a Craton account, ignore this email and nothing will happen.",
  );
  return deliver({ to, subject: "Confirm your email for Craton", text, html, kind: "verify" });
}

export function sendPasswordResetEmail(to: string, handle: string, url: string) {
  const { text, html } = layout(
    "Reset your password",
    [`Someone asked to reset the password for @${handle}. If that was you, choose a new one below. Every other session will be signed out.`, "The link works once and expires in an hour."],
    { label: "Choose a new password", url },
    "If you didn't ask for this, ignore this email. Your password won't change.",
  );
  return deliver({ to, subject: "Reset your Craton password", text, html, kind: "reset" });
}

export function sendInviteEmail(to: string, org: string, inviter: string, role: string, url: string) {
  const { text, html } = layout(`You've been added to ${org}`, [`${inviter} added you to the ${org} organization on Craton as a ${role}.`], { label: `Open ${org}`, url });
  return deliver({ to, subject: `You've been added to ${org} on Craton`, text, html, kind: "invite" });
}

export function sendRepoAccessEmail(to: string, repo: string, inviter: string, role: string, url: string) {
  const what = role === "Read" ? "read" : role === "Write" ? "read and write" : "administer";
  const { text, html } = layout(`You can now ${what} ${repo}`, [`${inviter} gave you ${role} access to ${repo} on Craton.`, "You can see it in your repositories, and leave it any time from its page."], { label: `Open ${repo}`, url });
  return deliver({ to, subject: `${inviter} shared ${repo} with you on Craton`, text, html, kind: "repo-access" });
}

export function sendRepoInviteEmail(to: string, repo: string, inviter: string, role: string, url: string) {
  const what = role === "Read" ? "read" : role === "Write" ? "read and write" : "administer";
  const { text, html } = layout(
    `${inviter} invited you to ${repo}`,
    [`${inviter} invited you to ${what} ${repo} on Craton, a place to keep and review hydrology and GIS files.`, "Create an account with this email address (or sign in to the one that uses it) and open the link below. It works once and expires in 14 days."],
    { label: "View the invitation", url },
  );
  return deliver({ to, subject: `${inviter} invited you to ${repo} on Craton`, text, html, kind: "repo-invite" });
}

export function sendReviewRequestEmail(to: string, repo: string, number: number, title: string, requester: string, url: string) {
  const { text, html } = layout(`${requester} asked for your review`, [`${requester} asked you to review pull request #${number} in ${repo}: ${title}.`], { label: `Review #${number}`, url });
  return deliver({ to, subject: `Review requested: ${repo}#${number} ${title}`, text, html, kind: "review-request" });
}

export function sendWebhookPausedEmail(to: string, repo: string, url: string, lastError: string, settingsUrl: string) {
  const { text, html } = layout(
    `A webhook of ${repo} was paused`,
    [
      `Craton stopped sending to ${url} after 10 deliveries in a row failed, each retried with growing delays.`,
      `The last error was: ${lastError}`,
      "Nothing is queued for it now. When the receiver works again, resume it in the repository's webhook settings; events that happened meanwhile are not replayed, but you can redeliver any from the log.",
    ],
    { label: "Open webhook settings", url: settingsUrl },
  );
  return deliver({ to, subject: `Webhook paused: ${repo}`, text, html, kind: "webhook-paused" });
}

export function sendAccountDeletedEmail(to: string, handle: string) {
  const { text, html } = layout(
    "Your Craton account was deleted",
    [
      `The account @${handle} and the repositories it owned were deleted just now.`,
      "Issues, comments and reviews you wrote in other people's repositories remain there, shown as @ghost. Backups made before today may still hold your data until they expire; they are not used to restore a deleted account.",
      "If you didn't do this, someone had your password. There is no way to undo a deletion, so tell the people you work with.",
    ],
    undefined,
    "You're receiving this one last message because the account that used this address was deleted.",
  );
  return deliver({ to, subject: "Your Craton account was deleted", text, html, kind: "account-deleted" });
}

export function sendStorageWarningEmail(to: string, account: string, percent: number, usedLabel: string, limitLabel: string, plan: string, url: string) {
  const full = percent >= 100;
  const { text, html } = layout(
    full ? `${account} is at its storage limit` : `${account} has used ${percent}% of its storage`,
    [
      `${account} has used ${usedLabel} of ${limitLabel} on the ${plan} plan.`,
      full ? "Nothing has been deleted. New data is refused until you free space or upgrade; everything already there stays readable." : "Nothing happens at the limit except that new data is refused; nothing is ever deleted.",
    ],
    { label: "See your usage", url },
  );
  return deliver({ to, subject: full ? `${account} is at its Craton storage limit` : `${account} has used ${percent}% of its Craton storage`, text, html, kind: "storage-warning" });
}

export function sendChecksFailedEmail(to: string, repo: string, branch: string, commit: string, failed: { name: string; detail: string }[], url: string) {
  const lines = failed.slice(0, 4).map((f) => `${f.name}: ${f.detail}`);
  const { text, html } = layout(
    `Checks failed on ${branch}`,
    [`Your push of ${commit.slice(0, 7)} to ${branch} in ${repo} didn't pass ${failed.length === 1 ? "a check" : `${failed.length} checks`}.`, ...lines, ...(failed.length > 4 ? [`and ${failed.length - 4} more.`] : [])],
    { label: "See the checks", url },
  );
  return deliver({ to, subject: `Checks failed: ${repo}@${branch}`, text, html, kind: "checks-failed" });
}

export function sendTwoFactorChangedEmail(to: string, handle: string, on: boolean, url: string) {
  const { text, html } = layout(
    on ? "Two-step verification is on" : "Two-step verification was turned off",
    on
      ? [`Two-step verification was turned on for @${handle}. From now on, signing in needs a code from your authenticator app as well as your password.`, "Keep your recovery codes somewhere safe. If you didn't do this, reset your password now."]
      : [`Two-step verification was turned off for @${handle}. Signing in now needs only your password.`, "If you didn't do this, reset your password now and turn it back on."],
    { label: "Review security settings", url },
  );
  return deliver({ to, subject: on ? "Two-step verification is on for your Craton account" : "Two-step verification was turned off on your Craton account", text, html, kind: "twofactor" });
}

export function sendNewSignInEmail(to: string, handle: string, device: string, url: string) {
  const { text, html } = layout(
    "New sign-in to your account",
    [`@${handle} just signed in from ${device}.`, "If this was you, there's nothing to do. If not, reset your password and sign out other sessions."],
    { label: "Review sessions", url },
  );
  return deliver({ to, subject: "New sign-in to Craton", text, html, kind: "signin" });
}
