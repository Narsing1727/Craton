"use client";

// Who is signed in, loaded once by app/layout.tsx. Null for signed-out visitors.

import { createContext, useContext } from "react";

export type SessionUser = { handle: string; name: string; email: string; emailVerified: boolean; writableOwners: string[] };

const SessionContext = createContext<SessionUser | null>(null);

export function SessionProvider({ user, children }: { user: SessionUser | null; children: React.ReactNode }) {
  return <SessionContext.Provider value={user}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
