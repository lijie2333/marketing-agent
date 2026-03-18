import type { NextAuthConfig } from "next-auth";

// Edge-compatible config: no DB, no bcrypt
// Used only in middleware
export const authConfig: NextAuthConfig = {
  pages: { signIn: "/login" },
  callbacks: {
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      return session;
    },
  },
  providers: [],
};
