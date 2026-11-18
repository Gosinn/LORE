import { useState } from 'react';
import { Link } from 'react-router';
import { SUPPORT_TOPIC_LABELS, SUPPORT_TOPICS, type SupportTopic } from '#shared';
import { ErrorNote, Field } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import { useMe } from '../lib/queries.ts';
import { PublicPage } from './Legal.tsx';

export function SupportPage() {
  const me = useMe();
  const [topic, setTopic] = useState<SupportTopic>('help');
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<ApiError | null>(null);
  const signedIn = !!me.data;

  async function send() {
    setState('sending');
    setError(null);
    try {
      await api.post('/support', { topic, body: body.trim(), replyTo: replyTo.trim() || undefined });
      setState('sent');
    } catch (err) {
      setError(err as ApiError);
      setState('idle');
    }
  }

  return (
    <PublicPage title="Help & contact">
      <h2>Quick answers</h2>
      <ul>
        <li>
          <strong>Something or someone bothering you?</strong> Tap <em>Report</em> on it (on a message, a chapter, a plan
          or a profile). You can block the person in the same step. We look at every report within 24 hours.
        </li>
        <li>
          <strong>Download or delete your data:</strong> Profile → Your data.
        </li>
        <li>
          <strong>Who can see what:</strong> every plan, idea and chapter shows its audience. Your calendar, notes and
          Loracle realm are only ever yours.
        </li>
        <li>
          <strong>Forgot your password?</strong> Write to us below from the email address on your account.
        </li>
      </ul>

      <h2>Write to us</h2>
      {state === 'sent' ? (
        <p className="banner">Thanks, it’s on its way. We’ll answer by email{signedIn ? ' at the address on your account' : ''}.</p>
      ) : (
        <div className="stack">
          <div className="chips wrap" role="radiogroup" aria-label="Topic">
            {SUPPORT_TOPICS.map((t) => (
              <button key={t} className="chip" role="radio" aria-checked={topic === t} aria-pressed={topic === t} onClick={() => setTopic(t)}>
                {SUPPORT_TOPIC_LABELS[t]}
              </button>
            ))}
          </div>
          <Field label="Message" htmlFor="support-body" error={error?.fields?.body}>
            <textarea id="support-body" className="textarea" rows={6} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <Field
            label={signedIn ? 'Answer me somewhere else (optional)' : 'Your email, so we can answer'}
            hint={signedIn ? 'Leave empty to use the email on your account.' : undefined}
            htmlFor="support-email"
            error={error?.fields?.replyTo}
          >
            <input
              id="support-email"
              className="input"
              type="email"
              autoComplete="email"
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
            />
          </Field>
          {error && !Object.keys(error.fields).length && <ErrorNote error={error} />}
          <button className="btn btn-primary btn-block" disabled={state === 'sending' || body.trim().length < 10} onClick={send}>
            {state === 'sending' ? 'Sending…' : 'Send'}
          </button>
          <p className="tiny muted">
            What you write is kept to answer you and deleted with your account. See the <Link to="/privacy">Privacy Policy</Link>.
          </p>
        </div>
      )}
    </PublicPage>
  );
}
