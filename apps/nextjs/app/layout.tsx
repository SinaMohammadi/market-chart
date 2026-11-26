import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'market-chart · Next.js App Router example',
  description:
    'Server-rendered static charts, a progressively enhanced chart and a full interactive chart. Synthetic data.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <a href="/">Market overview</a>
          <a href="/progressive">Progressive chart</a>
          <a href="/chart">Interactive chart</a>
          <span>All prices are synthetic</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
