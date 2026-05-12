import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import { ThemeProvider } from "@/components/theme-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: "DeployOps Console",
  description:
    "Single-operator dashboard for GitHub → Vercel → Neon deployments.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <head>
        {/* Pre-hydration: set html.dark to match prefers-color-scheme so
            users don't see a single-frame flash. Spec opted out of
            localStorage, so the only signal is the media query. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var l=window.matchMedia('(prefers-color-scheme: light)').matches;if(!l)document.documentElement.classList.add('dark');}catch(e){}})();",
          }}
        />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
