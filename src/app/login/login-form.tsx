'use client';

import { useRouter } from 'next/navigation';
import { Loader2, LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';

export interface LoginFormLabels {
  username: string;
  password: string;
  submit: string;
  submitting: string;
  invalid: string;
  rateLimited: string;
  notConfigured: string;
  serverError: string;
}

export function LoginForm({
  labels,
  nextPath,
}: {
  labels: LoginFormLabels;
  nextPath: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: String(form.get('username') ?? ''),
          password: String(form.get('password') ?? ''),
        }),
      });

      if (response.ok) {
        router.replace(nextPath);
        router.refresh();
        return;
      }

      if (response.status === 429) setError(labels.rateLimited);
      else if (response.status === 401) setError(labels.invalid);
      else if (response.status === 500) setError(labels.notConfigured);
      else setError(labels.serverError);
    } catch {
      setError(labels.serverError);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block text-sm font-medium text-slate-700">
        {labels.username}
        <input
          name="username"
          autoComplete="username"
          required
          defaultValue="admin"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
      </label>

      <label className="block text-sm font-medium text-slate-700">
        {labels.password}
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
      </label>

      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LogIn className="h-4 w-4" aria-hidden />}
        {pending ? labels.submitting : labels.submit}
      </button>
    </form>
  );
}
