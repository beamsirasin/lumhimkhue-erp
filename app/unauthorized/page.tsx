import Link from 'next/link';
import { ShieldOff } from 'lucide-react';

export const metadata = { title: 'ไม่มีสิทธิ์เข้าถึง — ร้านชาบู ERP' };

export default function Unauthorized() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <ShieldOff className="h-12 w-12 text-slate-400" aria-hidden="true" />
      <h1 className="text-xl font-medium text-slate-800">ไม่มีสิทธิ์เข้าถึง</h1>
      <p className="text-sm text-slate-500">บัญชีของคุณไม่ได้รับสิทธิ์สำหรับหน้านี้</p>
      <Link
        href="/"
        className="text-sm text-blue-600 underline underline-offset-2 hover:text-blue-800"
      >
        กลับหน้าหลัก
      </Link>
    </div>
  );
}
