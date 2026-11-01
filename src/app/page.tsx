import Link from 'next/link';
import { MessageCircleHeart, Sparkles } from 'lucide-react';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 px-6 py-16">
      <div className="flex items-center gap-3">
        <Sparkles className="h-8 w-8 text-brand-500" aria-hidden />
        <h1 className="text-3xl font-bold tracking-tight">ShopPulse AI</h1>
      </div>
      <p className="max-w-xl text-center text-slate-600">
        面向中小商家的 AI 客服挂件与营销文案助手。
        <br />
        AI customer-service widget and marketing copywriting assistant for small retailers.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/login"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <MessageCircleHeart className="h-4 w-4" aria-hidden />
          商家后台 / Admin
        </Link>
        <Link
          href="/demo"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          挂件演示 / Demo
        </Link>
      </div>
    </main>
  );
}
