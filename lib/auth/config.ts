import type { NextAuthConfig } from 'next-auth';

const adminPrefixes = ['/dashboard', '/menu', '/pricing-tiles', '/users', '/reports', '/settings'];
const managerPrefixes = ['/pricing-tiles'];

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

      const role = session!.user.role;

      // Admin-only paths (owner + manager can access pricing-tiles)
      if (adminPrefixes.some((p) => pathname.startsWith(p))) {
        const isManagerPath = managerPrefixes.some((p) => pathname.startsWith(p));
        if (isManagerPath) {
          if (role !== 'owner' && role !== 'manager') {
            return Response.redirect(new URL('/', nextUrl.origin));
          }
        } else {
          if (role !== 'owner') {
            return Response.redirect(new URL('/', nextUrl.origin));
          }
        }
      }

      if (pathname.startsWith('/kds')) {
        if (role !== 'kitchen' && role !== 'owner' && role !== 'cashier' && role !== 'manager') {
          return Response.redirect(new URL('/', nextUrl.origin));
        }
      }

      // /queue, /tables accessible to all authenticated roles
      // /tables/history accessible to all authenticated roles

      if (pathname.startsWith('/pos')) {
        if (role !== 'cashier' && role !== 'owner' && role !== 'manager') {
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
      session.user.role = token.role as Role;
      return session;
    },
  },
};

type Role = 'owner' | 'manager' | 'cashier' | 'kitchen';
