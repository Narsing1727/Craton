import type { Metadata, Viewport } from "next";
import { DM_Sans, Playfair_Display, Space_Mono } from "next/font/google";
import { ButtonStatusHost } from "@/components/button-status";
import { HoldPageHeight } from "@/components/hold-page-height";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider } from "@/components/session";
import { UnitsProvider } from "@/components/units";
import { getUnits } from "@/lib/units-server";
import { SpeculationRules } from "@/components/speculation-rules";
import { loadUser } from "@/lib/source";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

// The browser bar on a phone takes the page colour (the "darker" look by default; the other look updates it).
export const viewport: Viewport = { themeColor: "#0a0a0a", colorScheme: "dark" };

export const metadata: Metadata = {
  title: {
    default: "Craton — Version control for hydro & GIS engineers",
    template: "%s · Craton",
  },
  description:
    "Craton versions and syncs large geospatial files — DEMs, shapefiles, LiDAR, NetCDF model outputs, and HEC-RAS/SWMM projects — like git, with visual map diffs and shared public datasets.",
};

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});
const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});
const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
  display: "swap",
});

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [user, units] = await Promise.all([loadUser(), getUnits()]);
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${playfairDisplay.variable} ${spaceMono.variable} font-sans dark`}
      suppressHydrationWarning
    >
      <head>
        {/* Applies the saved theme before anything is drawn, so there is no flash of the other one. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="antialiased">
        <SpeculationRules />
        <SessionProvider user={user ? { handle: user.handle, name: user.name, email: user.email, emailVerified: user.emailVerified, writableOwners: user.writableOwners } : null}>
          <UnitsProvider units={units}>
            <TooltipProvider>{children}</TooltipProvider>
          </UnitsProvider>
        </SessionProvider>
        <ButtonStatusHost />
        <HoldPageHeight />
      </body>
    </html>
  );
}
