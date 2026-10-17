"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Navigation for controls that change what a page shows without changing where you are (a branch
 * picker, a period filter): the page keeps its scroll position and what is on screen stays until
 * the new content is ready, instead of jumping to the top and flashing. `pending` is true meanwhile,
 * for a light dimming.
 */
export function useSoftNav() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (href: string, mode: "push" | "replace" = "push") =>
    start(() => {
      router[mode](href, { scroll: false });
    });
  return { go, pending };
}
