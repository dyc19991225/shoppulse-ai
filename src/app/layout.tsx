import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ShopPulse AI',
  description: 'AI customer-service widget and marketing copywriting assistant for retailers.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
