"use client";

// When a filter makes a long list shorter while you are scrolled down, the page gets shorter than
// your scroll position and the browser throws you back toward the top, which feels like a reload.
// This notices a shrink that follows something you just clicked or typed, keeps the page as tall as
// it was, and puts you back where you were. It lets go when you scroll to the top or change page.

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function HoldPageHeight() {
  const pathname = usePathname();

  useEffect(() => {
    const body = document.body;
    body.style.minHeight = "";
    let previous = body.getBoundingClientRect().height;
    let touched = { y: 0, at: 0 };
    const note = () => (touched = { y: window.scrollY, at: Date.now() });
    const observer = new ResizeObserver(() => {
      const height = body.getBoundingClientRect().height;
      if (height < previous - 1 && touched.y > 0 && Date.now() - touched.at < 1500) {
        body.style.minHeight = `${previous}px`;
        window.scrollTo(0, touched.y);
      } else if (!body.style.minHeight) previous = height;
      else previous = Math.max(previous, height);
    });
    const onScroll = () => {
      if (window.scrollY <= 0 && body.style.minHeight) {
        body.style.minHeight = "";
        previous = body.getBoundingClientRect().height;
      }
    };
    observer.observe(body);
    document.addEventListener("pointerdown", note, true);
    document.addEventListener("keydown", note, true);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", note, true);
      document.removeEventListener("keydown", note, true);
      window.removeEventListener("scroll", onScroll);
      body.style.minHeight = "";
    };
  }, [pathname]);

  return null;
}
