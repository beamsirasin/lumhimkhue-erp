import type { ReactNode } from 'react';

export default function CustomerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-slate-100 flex justify-center">
      <div className="w-full max-w-sm bg-white min-h-dvh shadow-xl">
        {children}
      </div>
    </div>
  );
}
