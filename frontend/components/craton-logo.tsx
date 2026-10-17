import { Montserrat } from "next/font/google";
import { cn } from "@/lib/utils";

// The name set as a wordmark, no symbol: Montserrat's even, geometric capitals at a medium weight,
// spaced out. It is loaded for this one use; the rest of the app keeps its own fonts.
const wordmark = Montserrat({ subsets: ["latin"], weight: ["500"], display: "swap" });

export function CratonLogo({ className }: { className?: string }) {
  return <span className={cn(wordmark.className, "inline-block text-[15px] font-medium uppercase leading-none tracking-[0.24em]", className)}>Craton</span>;
}
