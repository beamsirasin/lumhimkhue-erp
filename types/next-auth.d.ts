import type { DefaultSession } from 'next-auth';

type StoredNavLayout = {
  sections: { heading: string; modules: string[] }[];
} | null;

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: 'owner' | 'manager' | 'cashier' | 'kitchen';
      branchId?: string | null;
      activeBranchId?: string | null;
      uiLayout?: 'touchscreen' | 'desktop' | 'tablet' | null;
      allowedModules?: string[] | null;
      navLayout?: StoredNavLayout;
      isActive?: boolean;
    } & DefaultSession['user'];
  }

  interface User {
    role: 'owner' | 'manager' | 'cashier' | 'kitchen';
    branchId?: string | null;
    uiLayout?: 'touchscreen' | 'desktop' | 'tablet' | null;
    allowedModules?: string[] | null;
    navLayout?: StoredNavLayout;
    isActive?: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: 'owner' | 'manager' | 'cashier' | 'kitchen';
    branchId?: string | null;
    activeBranchId?: string | null;
    uiLayout?: 'touchscreen' | 'desktop' | 'tablet' | null;
    allowedModules?: string[] | null;
    navLayout?: StoredNavLayout;
    isActive?: boolean;
  }
}
