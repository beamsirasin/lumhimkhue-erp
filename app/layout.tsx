import type { Metadata } from 'next';
import { IBM_Plex_Sans_Thai } from 'next/font/google';
import Script from 'next/script';
import { Toaster } from 'sonner';
import { QueryProvider } from '@/components/shared/QueryProvider';
import { ThemeProvider } from '@/components/shared/ThemeProvider';
import './globals.css';

const ibmPlexSansThai = IBM_Plex_Sans_Thai({
  weight: ['400', '500', '600', '700'],
  subsets: ['thai', 'latin'],
  variable: '--font-sans',
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
    <html lang="th" className={`${ibmPlexSansThai.variable} h-full`} suppressHydrationWarning>
      <body className="min-h-full font-sans antialiased">
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('lumhimkhue-theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}`,
          }}
        />
        <ThemeProvider>
          <QueryProvider>{children}</QueryProvider>
          <Toaster richColors position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
