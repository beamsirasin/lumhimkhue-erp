import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth/config';
import { NextResponse } from 'next/server';

const { auth } = NextAuth(authConfig);

/**
 * Sets x-current-path on every request that passes auth checks.
 * The (staff) layout reads this header to enforce allowedModules with fresh DB data,
 * avoiding the stale-JWT problem that would occur if module enforcement ran here.
 */
export default auth((req) => {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-current-path', req.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
});

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico)$).*)'],
};
