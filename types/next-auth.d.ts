import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: 'owner' | 'manager' | 'cashier' | 'kitchen';
    } & DefaultSession['user'];
  }

  interface User {
    role: 'owner' | 'manager' | 'cashier' | 'kitchen';
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: 'owner' | 'manager' | 'cashier' | 'kitchen';
  }
}
