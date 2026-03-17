import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const merchant = await db.merchant.findUnique({
          where: { email: credentials.email as string },
        });
        if (!merchant) return null;
        const valid = await bcrypt.compare(
          credentials.password as string,
          merchant.passwordHash
        );
        if (!valid) return null;
        return { id: merchant.id, email: merchant.email, name: merchant.name };
      },
    }),
  ],
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
  pages: { signIn: "/login" },
});
