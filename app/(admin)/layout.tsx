import { AppHeader } from '@/components/shared/AppHeader';
import { AdminNav } from '@/components/admin/AdminNav';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <AdminNav />
      <main className="flex-1 bg-slate-50">{children}</main>
    </div>
  );
}
