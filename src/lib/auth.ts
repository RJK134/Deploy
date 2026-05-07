import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

import { env } from "@/lib/env";

export const {
  handlers,
  auth,
  signIn,
  signOut,
} = NextAuth({
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
});
