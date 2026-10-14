"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { acceptInviteAction } from "@/app/actions";

export function AcceptInvite({ token, repo }: { token: string; repo: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function accept() {
    setPending(true);
    setError(null);
    const r = await acceptInviteAction(token);
    setPending(false);
    if (!r.ok) return void setError(r.error);
    router.push(`/${r.data.repo}`);
  }
  return (
    <div className="flex flex-col gap-3">
      <Button onClick={() => void accept()} loading={pending} disabled={pending} className="self-start">
        Join {repo}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
