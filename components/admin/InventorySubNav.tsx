'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ClipboardList,
  Package,
  RefreshCw,
  ShoppingBag,
  TrendingUp,
  Truck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type NavItem = {
  href: string;
  label: string;
  Icon: typeof Package;
  exact: boolean;
};

const ITEMS: NavItem[] = [
  { href: '/inventory', label: 'ภาพรวม', Icon: TrendingUp, exact: true },
  { href: '/inventory/count', label: 'นับสต็อก', Icon: ClipboardList, exact: false },
  { href: '/inventory/reorder', label: 'คำแนะนำสั่งซื้อ', Icon: RefreshCw, exact: false },
  { href: '/inventory/ingredients', label: 'วัตถุดิบ', Icon: Package, exact: false },
  { href: '/inventory/suppliers', label: 'ผู้ขาย', Icon: Truck, exact: false },
  { href: '/inventory/orders', label: 'ใบสั่งซื้อ', Icon: ShoppingBag, exact: false },
];

export function InventorySubNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="เมนูคลังวัตถุดิบ"
      className="flex gap-1 overflow-x-auto border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {ITEMS.map(({ href, label, Icon, exact }) => {
        const active = exact
          ? pathname === href
          : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm transition-colors',
              active
                ? 'border-primary font-medium text-primary'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
