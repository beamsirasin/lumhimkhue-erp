import type { ReactNode } from 'react';
import { InventorySubNav } from '@/components/admin/InventorySubNav';

export default function InventoryLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <div className="mx-auto w-full max-w-[1400px] px-6 pt-5">
        <InventorySubNav />
      </div>
      {children}
    </div>
  );
}
