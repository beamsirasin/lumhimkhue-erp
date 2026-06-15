import type { NextAuthConfig } from 'next-auth';

const adminPrefixes = ['/dashboard', '/menu', '/pricing-tiles', '/users', '/reports', '/settings', '/hr'];
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
    jwt({ token, user, trigger, session: updateData }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
        token.branchId = (user as { branchId?: string | null }).branchId ?? null;
        token.activeBranchId = (user as { branchId?: string | null }).branchId ?? null;
        token.uiLayout = (user as { uiLayout?: 'touchscreen' | 'desktop' | 'tablet' | null }).uiLayout ?? null;
        token.allowedModules = (user as { allowedModules?: string[] | null }).allowedModules ?? [];
        token.navLayout = (user as { navLayout?: { sections: { heading: string; modules: string[] }[]; labels: Record<string, string> } | null }).navLayout ?? null;
      }
      if (trigger === 'update' && updateData && typeof updateData === 'object') {
        const u = (updateData as { user?: Record<string, unknown> }).user ?? (updateData as Record<string, unknown>);
        if ('allowedModules' in u) token.allowedModules = u.allowedModules as string[] | null;
        if ('uiLayout' in u) token.uiLayout = u.uiLayout as 'touchscreen' | 'desktop' | 'tablet' | null;
        if ('navLayout' in u) token.navLayout = u.navLayout as { sections: { heading: string; modules: string[] }[]; labels: Record<string, string> } | null;
        if ('name' in u) token.name = u.name as string;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as Role;
      session.user.branchId = token.branchId as string | null | undefined;
      session.user.activeBranchId = token.activeBranchId as string | null | undefined;
      session.user.uiLayout = token.uiLayout as 'touchscreen' | 'desktop' | 'tablet' | null | undefined;
      session.user.allowedModules = token.allowedModules as string[] | null | undefined;
      session.user.navLayout = token.navLayout as { sections: { heading: string; modules: string[] }[]; labels: Record<string, string> } | null | undefined;
      return session;
    },
  },
};

type Role = 'owner' | 'manager' | 'cashier' | 'kitchen';
