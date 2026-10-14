// One loading boundary for the standalone sign-in pages. It has to live in a layout that stays
// mounted across them: a loading.tsx beside each page only shows if it was prefetched, and
// otherwise the router falls back to the app-wide one (site header and footer) between login,
// sign-up and forgot-password.
import { AuthLoading } from "@/components/auth-loading";

export default function Loading() {
  return <AuthLoading branded />;
}
