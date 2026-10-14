import type { MetadataRoute } from "next";

// Public data is meant to be found; private screens and the secret links people send each other are not.
export default function robots(): MetadataRoute.Robots {
  // The sitemap is listed when the public address is known (crawlers need an absolute one).
  const site = process.env.CRATON_SITE_URL?.replace(/\/+$/, "");
  return { ...(site ? { sitemap: `${site}/sitemap.xml` } : {}), rules: [{ userAgent: "*", allow: "/", disallow: ["/s/", "/settings", "/dashboard", "/onboarding", "/login", "/signup", "/new", "/orgs/new", "/issues", "/pulls", "/stars", "/invite", "/verify-email", "/reset-password", "/forgot-password", "/search"] }] };
}
