import { LoginForm } from '@/components/auth/LoginForm';

export const metadata = { title: 'เข้าสู่ระบบ — ร้านชาบู ERP' };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      {/* Left brand panel — hidden on mobile */}
      <div className="hidden lg:flex flex-col justify-between w-96 min-h-[480px] rounded-l-2xl p-10 mr-0" style={{ background: 'oklch(0.14 0.025 248)' }}>
        <div>
          <div className="flex size-10 items-center justify-center rounded-xl bg-blue-600/20 ring-1 ring-blue-400/30 mb-6">
            <span className="text-lg">🍲</span>
          </div>
          <h2 className="text-2xl font-semibold text-white leading-snug">ระบบจัดการ<br />ร้านชาบูบุฟเฟต์</h2>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            ครบวงจร ตั้งแต่รับออเดอร์ ครัว คิว POS ไปจนถึงรายงาน
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground">© 2025 ร้านชาบู ERP · All rights reserved</p>
      </div>

      {/* Login card */}
      <div className="w-full max-w-sm rounded-2xl lg:rounded-l-none bg-card border border-border shadow-lg p-8">
        <div className="mb-8 lg:hidden text-center">
          <span className="text-3xl">🍲</span>
          <h1 className="mt-2 text-xl font-semibold text-foreground">ร้านชาบู ERP</h1>
        </div>
        <div className="mb-7 hidden lg:block">
          <h1 className="text-[18px] font-semibold text-foreground">เข้าสู่ระบบ</h1>
          <p className="mt-1 text-sm text-muted-foreground">กรอกข้อมูลเพื่อดำเนินการต่อ</p>
        </div>
        <div className="lg:hidden mb-6 text-center">
          <p className="text-sm text-muted-foreground">เข้าสู่ระบบเพื่อดำเนินการต่อ</p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
