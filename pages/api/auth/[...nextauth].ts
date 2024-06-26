import { NextApiHandler } from 'next';
import NextAuth from 'next-auth';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import GitHubProvider from 'next-auth/providers/github';
import prisma from '../../../lib/prisma';

const authHandler: NextApiHandler = (req, res) => NextAuth(req, res, options);
export default authHandler;

const options = {
    providers: [
        GitHubProvider({
            clientId: process.env.GITHUB_ID,
            clientSecret: process.env.GITHUB_SECRET,
        }),
    ],
    adapter: PrismaAdapter(prisma),
    secret: process.env.SECRET,
    callbacks: {
        async session({ session, token, user }) {
            // ToDo - migrate to DB
            let isAuthorised = false
            const allowedUsers = process.env.ALLOWED_USERS.split(",")
            if(allowedUsers.includes(user.email)) {
                isAuthorised = true
            }
            session.user.isAuthotised = isAuthorised
            return session
        }
    }
};
