import { Lock } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { NoteItem, QuickNote } from '../components/notes.tsx';
import { Loading, Section, TopBar } from '../components/ui.tsx';
import { isNative } from '../lib/api.ts';
import { useNotes } from '../lib/queries.ts';

export function NotesPage() {
  const [params] = useSearchParams();
  const notes = useNotes();
  const d = notes.data;

  return (
    <>
      <TopBar back title="Notes" />
      <p className="small muted row" style={{ gap: 6, marginBottom: 12 }}>
        <Lock size={14} /> Only you can see these.
        {isNative ? ' Reminders pop up on this phone when they’re due.' : ' Reminders also show on Home when they’re due.'}
      </p>
      <QuickNote autoFocus={params.has('new')} />

      {notes.isLoading ? (
        <Loading />
      ) : (
        d && (
          <>
            <Section title="Reminders">
              {d.reminders.length ? (
                <div className="list">
                  {d.reminders.map((n) => (
                    <NoteItem key={n.id} note={n} />
                  ))}
                </div>
              ) : (
                <p className="small muted">No reminders. Type something and tap a time.</p>
              )}
            </Section>
            <Section title="Notes">
              {d.notes.length ? (
                <div className="list">
                  {d.notes.map((n) => (
                    <NoteItem key={n.id} note={n} />
                  ))}
                </div>
              ) : (
                <p className="small muted">Nothing jotted down yet.</p>
              )}
            </Section>
            {d.done.length > 0 && (
              <Section title="Done">
                <div className="list">
                  {d.done.map((n) => (
                    <NoteItem key={n.id} note={n} />
                  ))}
                </div>
              </Section>
            )}
          </>
        )
      )}
    </>
  );
}
