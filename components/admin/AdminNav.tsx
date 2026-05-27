'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/dashboard', label: 'แดชบอร์ด' },
  { href: '/reports', label: 'รายงาน' },
  { href: '/menu', label: 'เมนู' },
  { href: '/packages', label: 'แพ็กเกจ' },
  { href: '/users', label: 'พนักงาน' },
  { href: '/settings', label: 'ตั้งค่า' },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-slate-200 bg-white px-6 overflow-x-auto">
      <div className="flex gap-0 min-w-max">
        {LINKS.map((link) => {
          const active = pathname === link.href || pathname.startsWith(link.href + '/');
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                active
                  ? 'border-slate-800 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
