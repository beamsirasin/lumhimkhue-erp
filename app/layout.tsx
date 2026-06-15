import type { Metadata } from 'next';
import { IBM_Plex_Sans_Thai } from 'next/font/google';
import { Toaster } from 'sonner';
import { QueryProvider } from '@/components/shared/QueryProvider';
import './globals.css';

const ibmPlexSansThai = IBM_Plex_Sans_Thai({
  weight: ['400', '500'],
  subsets: ['thai', 'latin'],
  variable: '--font-ibm-plex-sans-thai',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ร้านชาบู ERP',
  description: 'ระบบจัดการร้านชาบูบุฟเฟต์',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" className={`${ibmPlexSansThai.variable} h-full`}>
      <body className="min-h-full font-[family-name:var(--font-ibm-plex-sans-thai)] antialiased">
        <QueryProvider>{children}</QueryProvider>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
