import type { NextAuthConfig } from 'next-auth';
import { can } from '@/lib/auth/permissions';
import { canAccessProtectedAdminPath } from '@/lib/auth/inventory-access';

/**
 * Route protection — two tiers:
 *   1. Role-based (primary): adminPrefixes + kds/pos role checks block wrong roles
 *      at the Edge before any DB query runs. Server actions enforce this again
 *      via can(role, action).
 *   2. Module-based (secondary): for cashier / kitchen / manager when
 *      allowedModules is non-empty. Owner always bypasses — they configure
 *      the module list and must never be locked out by it.
 */

// Admin routes remain owner-only except Inventory, which is governed by the
// explicit inventory:view permission. The shared helper is also used by the
// admin layout so navigation and direct URLs make the same decision.
const adminPrefixes = [
  '/dashboard', '/menu', '/pricing-tiles', '/users', '/reports',
  '/settings', '/hr', '/inventory', '/recipes', '/branches', '/system',
];


export const authConfig: NextAuthConfig = {
  providers: [],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    authorized({ auth: session, request: { nextUrl } }) {
      const isLoggedIn = !!session?.user;
      const { pathname } = nextUrl;

      if (pathname === '/login') {
        // Deactivated-but-logged-in users may land on /login; don't redirect them away.
        if (isLoggedIn && session!.user.isActive !== false) return Response.redirect(new URL('/', nextUrl.origin));
        return true;
      }

      // Customer QR routes are public.
      if (pathname.startsWith('/t/') || pathname.startsWith('/q/')) return true;

      if (!isLoggedIn) return false;

      // Block deactivated accounts from every protected route.
      // Strict === false so pre-fix JWTs (isActive = undefined) are unaffected.
      if (session!.user.isActive === false) {
        return Response.redirect(new URL('/login', nextUrl.origin));
      }

      // The /unauthorized page is accessible to any logged-in active user;
      // it must not be subject to module or role checks (to avoid redirect loops).
      if (pathname === '/unauthorized') return true;

      const role = session!.user.role;

      // --- Tier 1: role-based checks ---

      // Owner bypass remains unchanged. Inventory is permission-gated; every
      // other admin path stays owner-only.
      if (adminPrefixes.some((p) => pathname.startsWith(p))) {
        if (!canAccessProtectedAdminPath(role, pathname, can(role, 'inventory:view'))) {
          return Response.redirect(new URL('/', nextUrl.origin));
        }
      }

      if (pathname.startsWith('/kds')) {
        if (role !== 'kitchen' && role !== 'owner' && role !== 'cashier' && role !== 'manager') {
          return Response.redirect(new URL('/', nextUrl.origin));
        }
      }

      // /queue and /tables are accessible to all authenticated roles (no extra check).

      if (pathname.startsWith('/pos')) {
        if (role !== 'cashier' && role !== 'owner' && role !== 'manager') {
          return Response.redirect(new URL('/', nextUrl.origin));
        }
      }

      // Module-based enforcement runs in the (staff) layout using fresh DB data,
      // not here. See app/(staff)/layout.tsx and the x-current-path header set
      // in proxy.ts. Enforcing here would use stale JWT allowedModules, causing
      // false denies after an admin adds a module to a logged-in user.

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
        token.navLayout = (user as { navLayout?: { sections: { heading: string; modules: string[] }[] } | null }).navLayout ?? null;
        token.isActive = (user as { isActive?: boolean }).isActive ?? true;
      }
      if (trigger === 'update' && updateData && typeof updateData === 'object') {
        const u = (updateData as { user?: Record<string, unknown> }).user ?? (updateData as Record<string, unknown>);
        if ('allowedModules' in u) token.allowedModules = u.allowedModules as string[] | null;
        if ('uiLayout' in u) token.uiLayout = u.uiLayout as 'touchscreen' | 'desktop' | 'tablet' | null;
        if ('navLayout' in u) token.navLayout = u.navLayout as { sections: { heading: string; modules: string[] }[] } | null;
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
      session.user.navLayout = token.navLayout as { sections: { heading: string; modules: string[] }[] } | null | undefined;
      session.user.isActive = token.isActive as boolean | undefined;
      return session;
    },
  },
};

type Role = 'owner' | 'manager' | 'cashier' | 'kitchen';
