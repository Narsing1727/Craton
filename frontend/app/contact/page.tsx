import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, LifeBuoy, Mail, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/craton-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "How to reach the people who run this Craton deployment.",
};

export default function ContactPage() {
  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6">
        <PageHeader title="Contact" description="Questions about your account, your data, or whether Craton fits your project." />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="size-4 text-accent" aria-hidden /> Email
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            {CONTACT_EMAIL ? (
              <>
                <p>
                  Write to <span className="font-mono text-foreground">{CONTACT_EMAIL}</span>. Include your username and the repository, if it’s about one. Craton is run by a small team, so replies can take a few days.
                </p>
                <div>
                  <Button render={<a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Craton question")}`} />}>Email us</Button>
                </div>
              </>
            ) : (
              <p>This deployment hasn’t published a contact address yet (CRATON_CONTACT_EMAIL). Reach the people who run it directly.</p>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { icon: BookOpen, title: "Documentation", body: "Guides for the CLI, formats and checks.", href: "/docs", cta: "Read the docs" },
            { icon: LifeBuoy, title: "Help", body: "Answers to common questions.", href: "/help", cta: "Open help" },
            { icon: ShieldCheck, title: "Security", body: "Report a vulnerability privately.", href: "/security", cta: "How to report" },
          ].map((c) => (
            <Card key={c.title} className="p-5">
              <c.icon className="mb-2 size-5 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">{c.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{c.body}</p>
              <Link href={c.href} className="mt-3 inline-block text-xs text-accent underline-offset-2 hover:underline">
                {c.cta}
              </Link>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
