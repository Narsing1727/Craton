import Link from "next/link";
import { Lock } from "lucide-react";
import { CratonLogo } from "@/components/craton-logo";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between px-4">
          <Link href="/" aria-label="Craton home">
            <CratonLogo className="text-lg" />
          </Link>
          <span className="text-xs text-muted-foreground">Shared with you · read only</span>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        {children}
      </main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        Shared with Craton, version control for hydro and GIS data.{" "}
        <Link href="/signup" className="underline underline-offset-2 hover:text-foreground">
          Make a free account
        </Link>
      </footer>
    </div>
  );
}

export function Message({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <div className="mx-auto mt-16 max-w-md text-center">
        <Lock className="mx-auto size-6 text-muted-foreground" aria-hidden />
        <h1 className="mt-4 font-serif text-2xl">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground text-pretty">{body}</p>
      </div>
    </Shell>
  );
}

