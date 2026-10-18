import { BookOpen, CalendarPlus, Lightbulb, Users } from 'lucide-react';
import { Link } from 'react-router';
import { TopBar } from '../components/ui.tsx';

const OPTIONS = [
  {
    to: '/events/new',
    icon: CalendarPlus,
    title: 'Plan something',
    text: 'Pick a day, invite your people.',
    tone: ['var(--ember-soft)', 'var(--ember)'],
  },
  {
    to: '/ideas/new',
    icon: Lightbulb,
    title: 'Save an idea',
    text: 'No date needed. Just don’t let it get lost.',
    tone: ['var(--gold-soft)', 'var(--gold)'],
  },
  {
    to: '/chapters/new',
    icon: BookOpen,
    title: 'Write a chapter',
    text: 'Record something that happened, last night or years ago.',
    tone: ['var(--fjord-soft)', 'var(--fjord)'],
  },
  {
    to: '/crews/new',
    icon: Users,
    title: 'Start a crew',
    text: 'The people you make lore with.',
    tone: ['var(--surface-2)', 'var(--ink-2)'],
  },
];

export function CreatePage() {
  return (
    <>
      <TopBar title="Create" />
      <div className="create-grid">
        {OPTIONS.map((o) => (
          <Link key={o.to} to={o.to} className="create-tile">
            <span className="icon" style={{ background: o.tone[0], color: o.tone[1] }}>
              <o.icon size={22} />
            </span>
            <h3>{o.title}</h3>
            <p>{o.text}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
