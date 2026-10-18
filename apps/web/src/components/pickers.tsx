import { Check } from 'lucide-react';
import { useMemo } from 'react';
import { AUDIENCE_LABELS, EVENT_CATEGORIES, EVENT_CATEGORY_LABELS, type Audience, type EventCategory, type UserSummary } from '#shared';
import { useCrew, useCrews, useFriends, useMe } from '../lib/queries.ts';
import { Avatar } from './ui.tsx';

export function AudiencePicker<A extends Audience>({
  options,
  value,
  onChange,
  hasCrew,
}: {
  options: readonly A[];
  value: A;
  onChange: (a: A) => void;
  hasCrew: boolean;
}) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="chips wrap" role="radiogroup" aria-label="Who can see this">
        {options.map((a) => (
          <button
            type="button"
            key={a}
            className="chip"
            role="radio"
            aria-checked={value === a}
            aria-pressed={value === a}
            disabled={a === 'crew' && !hasCrew}
            title={a === 'crew' && !hasCrew ? 'Pick a crew first' : undefined}
            onClick={() => onChange(a)}
          >
            {AUDIENCE_LABELS[a].label}
          </button>
        ))}
      </div>
      <span className="hint small muted">{AUDIENCE_LABELS[value].hint}</span>
    </div>
  );
}

export function CrewSelect({ value, onChange, id }: { value: string | null; onChange: (id: string | null) => void; id?: string }) {
  const crews = useCrews();
  const active = (crews.data ?? []).filter((c) => c.myStatus === 'active');
  return (
    <select id={id} className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">No crew</option>
      {active.map((c) => (
        <option key={c.id} value={c.id}>
          {c.emoji} {c.name}
        </option>
      ))}
    </select>
  );
}

export function CategoryPicker({ value, onChange }: { value: EventCategory; onChange: (c: EventCategory) => void }) {
  return (
    <div className="chips" role="radiogroup" aria-label="Kind">
      {EVENT_CATEGORIES.map((c) => (
        <button
          type="button"
          key={c}
          className="chip"
          role="radio"
          aria-checked={value === c}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
        >
          <span aria-hidden>{EVENT_CATEGORY_LABELS[c].emoji}</span> {EVENT_CATEGORY_LABELS[c].label}
        </button>
      ))}
    </div>
  );
}

/**
 * Choose people from your friends and (if a crew is picked) its members: the only
 * people the server lets you invite or add anyway.
 */
export function PeoplePicker({
  crewId,
  selected,
  onChange,
  exclude = [],
}: {
  crewId: string | null;
  selected: string[];
  onChange: (ids: string[]) => void;
  exclude?: string[];
}) {
  const me = useMe();
  const friends = useFriends();
  const crew = useCrew(crewId ?? undefined);
  const people = useMemo(() => {
    const map = new Map<string, UserSummary>();
    for (const m of crew.data?.members ?? []) if (m.status === 'active') map.set(m.user.id, m.user);
    for (const f of friends.data ?? []) map.set(f.id, f);
    if (me.data) map.delete(me.data.id);
    for (const id of exclude) map.delete(id);
    return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [crew.data, friends.data, me.data, exclude]);

  if (friends.isLoading) return <p className="small muted">Loading your people…</p>;
  if (people.length === 0) {
    return <p className="small muted">No one to add yet. Add friends from your profile, or pick a crew.</p>;
  }
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  const allIn = people.every((p) => selected.includes(p.id));
  return (
    <div className="stack" style={{ gap: 6 }}>
      {crewId && people.length > 1 && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => onChange(allIn ? [] : people.map((p) => p.id))}
        >
          {allIn ? 'Clear' : 'Everyone'}
        </button>
      )}
      <div className="chips wrap">
        {people.map((p) => {
          const on = selected.includes(p.id);
          return (
            <button type="button" key={p.id} className="chip" aria-pressed={on} onClick={() => toggle(p.id)} style={{ paddingLeft: 4 }}>
              <Avatar user={p} size="sm" />
              {p.displayName}
              {on && <Check size={14} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
