import GitHub from "next-auth/providers/github";
import type { NextAuthConfig } from "next-auth";

import { env } from "@/lib/env";

// Edge-safe config: no DB imports, no Node-only modules. Both
// src/lib/auth.ts (Node handler) and src/middleware.ts (Edge) read this.
export const authConfig = {
  providers: [
    GitHub({
      clientId: env.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  secret: env.NEXTAUTH_SECRET,
  trustHost: true,
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  callbacks: {
    async signIn({ profile }) {
      const incomingEmail = profile?.email?.toLowerCase().trim();
      const allowed = env.ALLOWED_EMAIL.toLowerCase().trim();
      if (!incomingEmail || incomingEmail !== allowed) {
        return false;
      }
      return true;
    },
    async jwt({ token, profile }) {
      if (profile?.email) token.email = profile.email;
      if (profile?.name) token.name = profile.name;
      return token;
    },
    async session({ session, token }) {
      if (token.email && session.user) session.user.email = token.email;
      if (token.name && session.user) session.user.name = token.name as string;
      return session;
    },
  },
} satisfies NextAuthConfig;
