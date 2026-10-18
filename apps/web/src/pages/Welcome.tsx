import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import type { Me } from '#shared';
import { Backronym, Field, Loading, Wordmark } from '../components/ui.tsx';
import { api, ApiError, setNativeToken } from '../lib/api.ts';
import { useMe } from '../lib/queries.ts';

export function Welcome() {
  const me = useMe();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ login: '', username: '', displayName: '', email: '', password: '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';

  if (me.isLoading) return <Loading />;
  if (me.data) return <Navigate to={from} replace />;

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === 'login'
          ? await api.post<{ user: Me; token?: string }>('/auth/login', { login: form.login, password: form.password })
          : await api.post<{ user: Me; token?: string }>('/auth/register', {
              username: form.username,
              displayName: form.displayName,
              email: form.email,
              password: form.password,
            });
      if (res.token) setNativeToken(res.token);
      qc.setQueryData(['me'], res.user);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  const fe = error?.fields ?? {};
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="stack" style={{ gap: 8 }}>
          <Wordmark />
          <Backronym />
        </div>
        <h1 className="serif">
          Make life worth <em>remembering.</em>
        </h1>
        <p className="muted">
          Plan things with your people, then keep the story of what happened. No feed to scroll, just things to do and
          things worth remembering.
        </p>

        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={mode === 'login'} onClick={() => setMode('login')}>
            Sign in
          </button>
          <button role="tab" aria-selected={mode === 'register'} onClick={() => setMode('register')}>
            Create account
          </button>
        </div>

        <form className="form-grid" onSubmit={submit}>
          {mode === 'login' ? (
            <Field label="Username or email" htmlFor="login">
              <input id="login" className="input" autoComplete="username" value={form.login} onChange={set('login')} required />
            </Field>
          ) : (
            <>
              <Field label="Your name" hint="What friends call you." error={fe.displayName} htmlFor="displayName">
                <input id="displayName" className="input" autoComplete="name" value={form.displayName} onChange={set('displayName')} required />
              </Field>
              <Field label="Username" hint="How friends find you. Letters, numbers, dots and underscores." error={fe.username} htmlFor="username">
                <input
                  id="username"
                  className="input"
                  autoComplete="username"
                  autoCapitalize="none"
                  value={form.username}
                  onChange={set('username')}
                  required
                />
              </Field>
              <Field label="Email" hint="Only for your account. Never shown to anyone." error={fe.email} htmlFor="email">
                <input id="email" className="input" type="email" autoComplete="email" value={form.email} onChange={set('email')} required />
              </Field>
            </>
          )}
          <Field label="Password" hint={mode === 'register' ? 'At least 10 characters.' : undefined} error={fe.password} htmlFor="password">
            <input
              id="password"
              className="input"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={form.password}
              onChange={set('password')}
              required
            />
          </Field>
          {error && !Object.keys(fe).length && <p className="form-error">{error.message}</p>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Start your Lorebook'}
          </button>
        </form>
        <p className="tiny muted" style={{ textAlign: 'center' }}>
          Everything you add is private until you choose to share it.
        </p>
      </div>
    </div>
  );
}
