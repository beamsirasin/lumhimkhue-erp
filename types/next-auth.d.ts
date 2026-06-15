import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: 'owner' | 'manager' | 'cashier' | 'kitchen';
      branchId?: string | null;
      activeBranchId?: string | null;
      uiLayout?: 'touchscreen' | 'desktop' | null;
      allowedModules?: string[] | null;
    } & DefaultSession['user'];
  }

  interface User {
    role: 'owner' | 'manager' | 'cashier' | 'kitchen';
    branchId?: string | null;
    uiLayout?: 'touchscreen' | 'desktop' | null;
    allowedModules?: string[] | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: 'owner' | 'manager' | 'cashier' | 'kitchen';
    branchId?: string | null;
    activeBranchId?: string | null;
    uiLayout?: 'touchscreen' | 'desktop' | null;
    allowedModules?: string[] | null;
  }
}
