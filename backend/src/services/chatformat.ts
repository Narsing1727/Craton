// Webhooks that post into a chat room: Slack, Microsoft Teams and Discord (and anything that reads the same shape, such as
// Mattermost). Those services take one fixed JSON shape at their own incoming-webhook address, not Craton's signed
// envelope, so a webhook has a format and the message is written here from the same event data.
//
// The text is plain and short: who did what, where, and a link. Everything that came from a person (names, titles, commit
// messages) is escaped for the service it goes to, so a pull request called "<!channel> deploy" cannot ping a room.

import { config } from "../config.ts";

export const FORMATS = ["json", "slack", "teams", "discord"] as const;
export type Format = (typeof FORMATS)[number];

/** The format an address implies: the chat services' own webhook hosts. Anything else is plain signed JSON. */
export function detectFormat(url: string): Format {
  let host = "";
  let path = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    path = u.pathname;
  } catch {
    return "json";
  }
  if (host === "hooks.slack.com" || host === "hooks.slack-gov.com") return "slack";
  if ((host === "discord.com" || host === "discordapp.com" || host.endsWith(".discord.com")) && path.startsWith("/api/webhooks/")) return path.endsWith("/slack") ? "slack" : "discord";
  if (host.endsWith(".webhook.office.com") || host.endsWith(".logic.azure.com") || host.endsWith(".powerplatform.com") || host.endsWith(".environment.api.powerplatform.com")) return "teams";
  return "json";
}

type Repo = { owner: string; name: string };
type Data = Record<string, unknown>;

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : v === null || v === undefined ? "" : String(v).slice(0, max));
const short = (sha: unknown) => str(sha, 64).slice(0, 7);

/** What happened, in a sentence, with the address to open. Plain text: each service marks it up for itself. */
export type Summary = { headline: string; lines: string[]; url: string };

export function summarize(repo: Repo, event: string, data: Data): Summary {
  const site = config.webUrl.replace(/\/+$/, "");
  const base = `${site}/${repo.owner}/${repo.name}`;
  const slug = `${repo.owner}/${repo.name}`;
  switch (event) {
    case "push": {
      const commits = Array.isArray(data.commits) ? (data.commits as Data[]) : [];
      const n = commits.length;
      const branch = str(data.branch, 100);
      const created = !data.before;
      const verb = created ? `created branch ${branch}` : `pushed ${n === 1 ? "1 commit" : `${n} commits`} to ${branch}`;
      return {
        headline: `${str(data.pusher, 60) || "Someone"} ${verb} in ${slug}`,
        lines: commits.slice(0, 5).map((c) => `${short(c.sha)}  ${str(String(c.message ?? "").split("\n")[0], 120)}`),
        url: n === 1 && commits[0]?.sha ? `${base}/commit/${str(commits[0].sha, 64)}` : `${base}/commits/${encodeURIComponent(branch)}`,
      };
    }
    case "pull_request": {
      const action = str(data.action, 20);
      const who = str(data.author ?? data.mergedBy ?? data.closedBy, 60) || "Someone";
      const by = action === "merged" ? str(data.mergedBy, 60) || who : action === "closed" ? str(data.closedBy, 60) || who : who;
      return { headline: `${by} ${action} pull request #${str(data.number, 10)} in ${slug}`, lines: [str(data.title, 200), `${str(data.source, 80)} → ${str(data.target, 80)}`], url: `${base}/pull/${str(data.number, 10)}` };
    }
    case "release":
      return { headline: `${str(data.author, 60) || "Someone"} published release ${str(data.tag, 80)} in ${slug}`, lines: [str(data.title, 200), data.prerelease ? "Pre-release" : "", `Merkle root ${str(data.merkleRoot, 64).slice(0, 16)}…`].filter(Boolean), url: `${base}/releases/${encodeURIComponent(str(data.tag, 80))}` };
    case "issue": {
      const action = str(data.action, 20);
      const by = str(data.author ?? data.by, 60) || "Someone";
      return { headline: `${by} ${action} issue #${str(data.number, 10)} in ${slug}`, lines: [str(data.title, 200)], url: `${base}/issues/${str(data.number, 10)}` };
    }
    case "lock": {
      const locked = str(data.action, 20) === "locked";
      return {
        headline: locked ? `${str(data.holder, 60) || "Someone"} locked ${str(data.path, 200)} in ${slug}` : `${str(data.by, 60) || "Someone"} released the lock on ${str(data.path, 200)} in ${slug}${data.forced ? " (forced)" : ""}`,
        lines: locked && data.reason ? [`Reason: ${str(data.reason, 200)}`] : [],
        url: `${base}/settings/locks`,
      };
    }
    case "ping":
      return { headline: `Craton is connected to ${slug}`, lines: ["This room will get a message when something happens in the repository."], url: base };
    default:
      return { headline: `${event} in ${slug}`, lines: [], url: base };
  }
}

// ── escaping, per service ─────────────────────────────────────────────────────

/** Slack reads &, < and > as markup (mentions and links are written with them); everything else is literal. */
const slackEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Discord and Teams treat these as markdown: a backslash in front keeps them literal. @ is broken with a zero-width space. */
const markdownEscape = (s: string) => s.replace(/([\\`*_~|>[\]()#])/g, "\\$1").replace(/@/g, "@\u200b");

/** The JSON body to POST for a format. Throws for "json", which is not built here. */
export function chatBody(format: Exclude<Format, "json">, repo: Repo, event: string, data: Data): unknown {
  const s = summarize(repo, event, data);
  if (format === "slack") {
    const body = s.lines.length ? `\n${s.lines.map(slackEscape).join("\n")}` : "";
    return {
      // `text` is what notifications and old clients show; the blocks are the same words, with a link.
      text: slackEscape(s.headline),
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*${slackEscape(s.headline)}*${body}` } },
        { type: "context", elements: [{ type: "mrkdwn", text: `<${s.url}|Open in Craton>` }] },
      ],
      unfurl_links: false,
    };
  }
  if (format === "teams") {
    return {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: [
              { type: "TextBlock", text: markdownEscape(s.headline), weight: "Bolder", wrap: true },
              ...s.lines.map((l) => ({ type: "TextBlock", text: markdownEscape(l), wrap: true, isSubtle: true, spacing: "Small" })),
            ],
            actions: [{ type: "Action.OpenUrl", title: "Open in Craton", url: s.url }],
          },
        },
      ],
    };
  }
  return {
    // No pings, whatever the text says.
    allowed_mentions: { parse: [] as string[] },
    embeds: [{ title: markdownEscape(s.headline).slice(0, 256), description: s.lines.map(markdownEscape).join("\n").slice(0, 4000) || undefined, url: s.url, color: 0x1f5cff }],
  };
}
