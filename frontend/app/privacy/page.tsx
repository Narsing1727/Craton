import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Separator } from "@/components/ui/separator";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What Craton collects, where your data is stored, how deduplication treats private data, and your rights.",
};

const sections = [
  {
    id: "collect",
    title: "1. What we collect",
    body: "Your account details (name, username, email), the files you push and their metadata (paths, sizes, CRS, commit messages), and minimal service logs such as request times and error codes. We don’t use advertising trackers.",
  },
  {
    id: "content",
    title: "2. Your repository content",
    body: "Files are split into chunks and each chunk is identified by its hash. We store chunks to serve your repositories and verify their integrity. We never read, analyse or train models on private repository content.",
  },
  {
    id: "dedup",
    title: "3. Deduplication and private data",
    body: "Deduplication across accounts applies only to public data. Chunks in private repositories are never matched against, or made available to, anyone outside the repository’s owners and collaborators.",
  },
  {
    id: "storage",
    title: "4. Where data lives",
    body: "Chunks are stored in Cloudflare R2 when the service is configured with it, which encrypts every object at rest; on a plain disk, protection is that of the server it runs on (see Security). Transfers use TLS in production, and every chunk is verified against the commit’s Merkle root when it’s read.",
  },
  {
    id: "retention",
    title: "5. Retention and deletion",
    body: "History is kept for as long as the repository exists. When you delete a repository or account, its unique chunks are removed by garbage collection once a 30-day grace period has passed; chunks that other public repositories still reference are kept for them. Backups made before the deletion may keep copies until they expire.",
  },
  {
    id: "rights",
    title: "6. Your rights",
    body: "You can export everything with craton clone at any time, correct your account details in settings, and ask us to delete your account. We respond to access and deletion requests within 30 days.",
  },
  {
    id: "processors",
    title: "7. Service providers",
    body: "We use a small set of providers to run Craton: Cloudflare (storage and network), a payment processor for paid plans, and an email provider for notifications. Each only receives what it needs.",
  },
  {
    id: "cookies",
    title: "8. Cookies",
    body: "We set only the cookies needed to keep you signed in and remember preferences. There are no third-party analytics or advertising cookies.",
  },
];

export default function PrivacyPage() {
  return (
    <AppShell>
      <div className="grid grid-cols-1 w-full gap-10 px-4 sm:px-6 lg:px-8 xl:px-10 py-12 md:grid-cols-[1fr_260px]">
        <article className="min-w-0 max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight text-balance">Privacy policy</h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated September 30, 2026</p>
          <Separator className="my-6" />
          <div className="flex flex-col gap-8">
            {sections.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-20">
                <h2 className="text-lg font-semibold">{s.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">{s.body}</p>
              </section>
            ))}
          </div>
          <Separator className="my-8" />
          <p className="text-sm text-muted-foreground">
            Questions or requests? Write to us from the <Link href="/contact" className="text-accent underline underline-offset-2">contact page</Link>, or read the{" "}
            <Link href="/terms" className="text-accent underline underline-offset-2">Terms of service</Link>.
          </p>
        </article>

        <aside className="hidden md:block">
          <nav aria-label="On this page" className="sticky top-20 flex flex-col text-[15px]">
            <p className="pb-2 font-medium">On this page</p>
            {sections.map((s) => (
              <Link key={s.id} href={`#${s.id}`} className="py-1.5 text-muted-foreground transition-colors hover:text-foreground">
                {s.title}
              </Link>
            ))}
          </nav>
        </aside>
      </div>
    </AppShell>
  );
}
