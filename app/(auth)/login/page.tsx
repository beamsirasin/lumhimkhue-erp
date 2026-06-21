import Image from 'next/image';
import { LoginForm } from '@/components/auth/LoginForm';

export const metadata = { title: 'เข้าสู่ระบบ — ลำฮิมคือ ชาบู บุฟเฟต์' };

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-3xl overflow-hidden rounded-2xl border border-border shadow-xl">

        {/* Left brand panel */}
        <div
          className="hidden lg:flex flex-col justify-between w-[340px] shrink-0 p-10"
          style={{ background: 'var(--sidebar-header)' }}
        >
          <div className="space-y-8">
            {/* Logo */}
            <div className="relative size-16 overflow-hidden rounded-2xl ring-1 ring-white/10">
              <Image
                src="/images/logo.png"
                alt="ลำฮิมคือ ชาบู บุฟเฟต์"
                fill
                sizes="64px"
                className="object-cover"
                priority
              />
            </div>

            {/* Brand */}
            <div className="space-y-3">
              <p className="text-[11px] font-semibold tracking-widest text-blue-400/80 uppercase">
                Lum Him Khue
              </p>
              <h2 className="text-2xl font-bold text-white leading-snug">
                ลำฮิมคือ<br />ชาบู บุฟเฟต์
              </h2>
              <p className="text-sm text-slate-400/90 leading-relaxed">
                ระบบจัดการร้านครบวงจร<br />
                POS · KDS · คิว · รายงาน · HR
              </p>
            </div>

            {/* Feature list */}
            <div className="space-y-2.5">
              {[
                'รับออเดอร์ผ่าน QR Code',
                'ครัว KDS real-time',
                'รายงาน & P&L',
              ].map((f) => (
                <div key={f} className="flex items-center gap-2.5 text-sm text-slate-400">
                  <span className="size-1.5 rounded-full bg-blue-400/60 shrink-0" />
                  {f}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="h-px bg-white/8 mb-4" />
            <p className="text-[11px] text-slate-600">
              © 2025 ลำฮิมคือ ชาบู บุฟเฟต์
            </p>
          </div>
        </div>

        {/* Right login card */}
        <div className="flex-1 bg-card flex flex-col justify-center px-8 md:px-10 py-12">

          {/* Mobile header */}
          <div className="mb-8 flex flex-col items-center lg:hidden">
            <div className="relative size-14 overflow-hidden rounded-2xl mb-4 ring-1 ring-border">
              <Image
                src="/images/logo.png"
                alt="ลำฮิมคือ ชาบู บุฟเฟต์"
                fill
                sizes="56px"
                className="object-cover"
                priority
              />
            </div>
            <h1 className="text-base font-bold text-foreground">ลำฮิมคือ ชาบู บุฟเฟต์</h1>
            <p className="text-sm text-muted-foreground mt-1">เข้าสู่ระบบเพื่อดำเนินการต่อ</p>
          </div>

          {/* Desktop header */}
          <div className="hidden lg:block mb-8">
            <h1 className="text-xl font-bold text-foreground tracking-tight">เข้าสู่ระบบ</h1>
            <p className="mt-1 text-sm text-muted-foreground">กรอกข้อมูลเพื่อดำเนินการต่อ</p>
          </div>

          <LoginForm />
        </div>

      </div>
    </div>
  );
}
