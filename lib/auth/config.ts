import type { NextAuthConfig } from 'next-auth';

const adminPrefixes = ['/dashboard', '/menu', '/packages', '/users', '/reports', '/settings'];

export const authConfig: NextAuthConfig = {
  providers: [],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    authorized({ auth: session, request: { nextUrl } }) {
      const isLoggedIn = !!session?.user;
      const { pathname } = nextUrl;

      if (pathname === '/login') {
        if (isLoggedIn) return Response.redirect(new URL('/', nextUrl.origin));
        return true;
      }

      if (pathname.startsWith('/t/') || pathname.startsWith('/q/')) return true;

      if (!isLoggedIn) return false;

      if (adminPrefixes.some((p) => pathname.startsWith(p))) {
        if (session!.user.role !== 'owner') {
          return Response.redirect(new URL('/', nextUrl.origin));
        }
      }

      if (pathname.startsWith('/kds')) {
        const role = session!.user.role;
        // kitchen, owner, cashier can view KDS
        if (role !== 'kitchen' && role !== 'owner' && role !== 'cashier') {
          return Response.redirect(new URL('/', nextUrl.origin));
        }
      }

      // /queue is accessible to all authenticated roles
      // /tables is accessible to all authenticated roles

      if (pathname.startsWith('/pos')) {
        const role = session!.user.role;
        if (role !== 'cashier' && role !== 'owner') {
          return Response.redirect(new URL('/', nextUrl.origin));
        }
      }

      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as 'owner' | 'cashier' | 'kitchen' | 'host';
      return session;
    },
  },
};
