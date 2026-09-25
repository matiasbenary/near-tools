import '@/app/globals.css';

import { Inter, JetBrains_Mono } from 'next/font/google';
import { Navigation } from '@/components/navigation';
import { ReactNode } from 'react';
import { AppProviders } from '@/components/app-providers';
import { SiteFooter } from '@/components/site-footer';

const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <AppProviders>
          <Navigation />
          {children}
          <SiteFooter />
        </AppProviders>
      </body>
    </html>
  );
}
