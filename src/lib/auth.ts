import NextAuth from "next-auth";

import { authConfig } from "@/lib/auth.config";
import { upsertOperator } from "@/lib/db/users";

const baseSignIn = authConfig.callbacks?.signIn;

// Full Node-side auth handler: wraps the edge-safe config and extends
// signIn to upsert the operator row after the allowlist check passes.
export const {
  handlers,
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async signIn(params) {
      const allowed = baseSignIn
        ? await baseSignIn(params)
        : true;
      if (!allowed) return false;

      const email = params.profile?.email?.toLowerCase().trim();
      if (!email) return false;

      const avatar =
        typeof params.profile?.avatar_url === "string"
          ? params.profile.avatar_url
          : null;
      await upsertOperator({
        email,
        name:
          typeof params.profile?.name === "string"
            ? params.profile.name
            : null,
        image: avatar,
      });
      return true;
    },
  },
});
