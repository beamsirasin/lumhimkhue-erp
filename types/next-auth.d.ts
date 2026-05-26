import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: 'owner' | 'cashier' | 'kitchen' | 'host';
    } & DefaultSession['user'];
  }

  interface User {
    role: 'owner' | 'cashier' | 'kitchen' | 'host';
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: 'owner' | 'cashier' | 'kitchen' | 'host';
  }
}
