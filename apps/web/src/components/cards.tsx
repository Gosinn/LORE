import { BookOpen, ChevronRight, MapPin, Users } from 'lucide-react';
import { Link } from 'react-router';
import {
  EVENT_CATEGORY_LABELS,
  RSVP_LABELS,
  type ChapterSummary,
  type CrewRef,
  type CrewSummary,
  type EventSummary,
  type IdeaSummary,
} from '#shared';
import { mediaSrc } from '../lib/api.ts';
import { fmtChapterDate, fmtDayNum, fmtMonthShort, fmtWhen, yearsAgo } from '../lib/dates.ts';
import { EventStatusPill, IdeaStatusPill, PrivacyBadge } from './ui.tsx';

export function EventCard({ event, note }: { event: EventSummary; note?: string }) {
  const cat = EVENT_CATEGORY_LABELS[event.category];
  const dim = event.status === 'canceled';
  return (
    <Link to={`/events/${event.id}`} className="card card-link" style={dim ? { opacity: 0.6 } : undefined}>
      <div className="event-row">
        <div className="date-tile" aria-hidden>
          <span className="m">{fmtMonthShort(event.startsAt)}</span>
          <span className="d">{fmtDayNum(event.startsAt)}</span>
        </div>
        <div className="grow stack" style={{ gap: 4 }}>
          <span className="event-title">
            <span aria-hidden>{cat.emoji} </span>
            {event.title}
          </span>
          <span className="meta">
            <span>{fmtWhen(event)}</span>
            {event.locationName && (
              <span>
                <MapPin size={13} />
                <span className="ellipsis" style={{ maxWidth: 180 }}>
                  {event.locationName}
                </span>
              </span>
            )}
            {event.goingCount > 0 && (
              <span>
                <Users size={13} /> {event.goingCount} going
              </span>
            )}
          </span>
          <span className="row-wrap" style={{ gap: 6 }}>
            {event.status !== 'planning' && <EventStatusPill status={event.status} />}
            {event.myRsvp && event.myRsvp !== 'going' && event.status !== 'completed' && (
              <span className={`pill ${event.myRsvp === 'invited' ? 'pill-ember' : ''}`}>
                {event.myRsvp === 'invited' ? 'Needs your answer' : RSVP_LABELS[event.myRsvp]}
              </span>
            )}
            {event.crew && <CrewTag crew={event.crew} />}
            {note && <span className="tiny muted">{note}</span>}
          </span>
        </div>
        <ChevronRight size={18} className="muted" />
      </div>
    </Link>
  );
}

export function CrewTag({ crew }: { crew: CrewRef }) {
  return (
    <span className="pill">
      {crew.emoji} {crew.name}
    </span>
  );
}

export function ChapterCard({ chapter, showYearsAgo }: { chapter: ChapterSummary; showYearsAgo?: boolean }) {
  const ago = showYearsAgo ? yearsAgo(chapter.occurredOn) : 0;
  return (
    <Link to={`/chapters/${chapter.id}`} className="card card-link chapter-card">
      {chapter.cover ? (
        <img className="chapter-cover" src={mediaSrc(chapter.cover.url)} alt="" loading="lazy" />
      ) : (
        <div className="cover-placeholder" aria-hidden>
          <BookOpen size={28} />
        </div>
      )}
      <div className="chapter-body">
        <span className="chapter-date">
          {ago > 0 ? `${ago} year${ago === 1 ? '' : 's'} ago · ` : ''}
          {fmtChapterDate(chapter.occurredOn, chapter.endedOn)}
        </span>
        <span className="chapter-title">{chapter.title}</span>
        {chapter.summary && (
          <p className="small muted" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {chapter.summary}
          </p>
        )}
        <span className="meta">
          {chapter.locationName && (
            <span>
              <MapPin size={13} /> {chapter.locationName}
            </span>
          )}
          <span>
            <Users size={13} /> {chapter.peopleCount}
          </span>
          {chapter.contributionCount > 0 && (
            <span>
              {chapter.contributionCount} {chapter.contributionCount === 1 ? 'memory' : 'memories'}
            </span>
          )}
          <PrivacyBadge audience={chapter.audience} crewName={chapter.crew?.name} />
        </span>
      </div>
    </Link>
  );
}

export function IdeaCard({ idea }: { idea: IdeaSummary }) {
  const cat = EVENT_CATEGORY_LABELS[idea.category];
  return (
    <Link to={`/ideas/${idea.id}`} className="card card-link idea-card">
      <div className="stack" style={{ gap: 8 }}>
        <span className="idea-title">
          <span aria-hidden>{cat.emoji} </span>
          {idea.title}
        </span>
        <span className="row-wrap" style={{ gap: 6 }}>
          <IdeaStatusPill status={idea.status} />
          {idea.interestedCount > 0 && (
            <span className="pill">
              {idea.interestedCount} {idea.interestedCount === 1 ? 'is' : 'are'} in{idea.iAmInterested ? ' (incl. you)' : ''}
            </span>
          )}
          {idea.crew && <CrewTag crew={idea.crew} />}
          {idea.audience !== 'crew' && <PrivacyBadge audience={idea.audience} />}
        </span>
      </div>
    </Link>
  );
}

export function CrewChip({ crew }: { crew: CrewSummary }) {
  return (
    <Link to={`/crews/${crew.id}`} className="crew-chip">
      <span className="crew-emoji">{crew.emoji}</span>
      <span>
        {crew.name}
        <span className="tiny muted" style={{ display: 'block', fontWeight: 500 }}>
          {crew.memberCount} {crew.memberCount === 1 ? 'member' : 'members'}
        </span>
      </span>
    </Link>
  );
}
