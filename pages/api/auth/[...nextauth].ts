import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { NextApiHandler } from 'next';
import NextAuth from 'next-auth';
import GitHubProvider from 'next-auth/providers/github';

import { isAllowedOperator } from '../../../lib/adminAllow';
import prisma from '../../../lib/prisma';

const authHandler: NextApiHandler = (req, res) => NextAuth(req, res, authOptions);
export default authHandler;

export const authOptions = {
    providers: [
        GitHubProvider({
            clientId: process.env.GITHUB_ID,
            clientSecret: process.env.GITHUB_SECRET,
        }),
    ],
    adapter: PrismaAdapter(prisma),
    secret: process.env.SECRET,
    callbacks: {
        // Deny sign-in for non-allow-listed GitHub users — they never establish a
        // session and simply browse as the public. Keyed on the immutable GitHub id
        // (account.providerAccountId).
        async signIn({ account, profile }: { account?: { providerAccountId?: string | null } | null; profile?: { email?: string | null } | null }) {
            return isAllowedOperator({ githubId: account?.providerAccountId, email: profile?.email })
        },
        async session({ session, user }) {
            // Re-validate on every session read (so removing an id from the allow-list
            // locks the user out on their next request). The GitHub id lives on the
            // linked Account row — the DB `user` here carries no provider id.
            const account = await prisma.account.findFirst({
                where: { userId: user.id, provider: "github" },
                select: { providerAccountId: true },
            })
            session.user.isAuthorised = isAllowedOperator({ githubId: account?.providerAccountId, email: user.email })
            return session
        },
    },
};
