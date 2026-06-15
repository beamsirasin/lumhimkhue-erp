import Link from 'next/link';
import { auth, signOut } from '@/auth';

const roleLabel: Record<string, string> = {
  owner: 'เจ้าของร้าน',
  cashier: 'แคชเชียร์',
  kitchen: 'ครัว',
};

export async function AppHeader() {
  const session = await auth();
  if (!session?.user) return null;

  const { name, role } = session.user;

  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex h-14 max-w-screen-xl items-center justify-between px-4">
        <Link
          href="/"
          className="text-sm font-medium text-foreground hover:text-foreground"
        >
          ร้านชาบู ERP
        </Link>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-medium leading-tight text-foreground">{name}</p>
            <p className="text-xs leading-tight text-muted-foreground">
              {roleLabel[role] ?? role}
            </p>
          </div>

          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/login' });
            }}
          >
            <button
              type="submit"
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/30"
            >
              ออกจากระบบ
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
