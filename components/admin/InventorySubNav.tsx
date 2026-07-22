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
import { INVENTORY_NAV_ITEMS } from '@/lib/inventory/inventory-nav';

const ICONS: Record<string, typeof Package> = {
  '/inventory': TrendingUp,
  '/inventory/count': ClipboardList,
  '/inventory/reorder': RefreshCw,
  '/inventory/orders': ShoppingBag,
  '/inventory/ingredients': Package,
  '/inventory/suppliers': Truck,
};

export function InventorySubNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="เมนูคลังวัตถุดิบ"
      className="flex gap-1 overflow-x-auto border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {INVENTORY_NAV_ITEMS.map(({ href, label, exact }) => {
        const Icon = ICONS[href] ?? Package;
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
