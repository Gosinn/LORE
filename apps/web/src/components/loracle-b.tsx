// The Loracle, phases B and C: asking the stone about a waypoint, "Ask again" and its "Two roads", the dawn
// lane's wait, showing a quest to a crew, walking beside a Lorer, and the Epic of a wish come true. The same
// temple kit as loracle.tsx: carved stone for what you touch on the wall, parchment for what the stone says,
// wax for what is final, ember the only light. Styles: styles/loracle-b.css (the Loracle page only).
// Words come from LORACLE_LINES (packages/shared/src/vocabulary.ts), so the owner can reword them live (D33).
import { BookOpen, Check, Footprints, Moon, Users } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  LORACLE_LINES,
  STEP_KIND_LABELS,
  fillLine,
  type CareView,
  type CrewQuestSummary,
  type DeeperView,
  type EpicView,
  type EpicWaypoint,
  type OpenWaypoint,
  type UserSummary,
  type Waypoint,
  type Wish,
  type WishScroll,
} from '#shared';
import { api, type ApiError } from '../lib/api.ts';
import { asksOf, isMine, roadAtDawn, roadInProgress, roadWalked, sharedCrew, walkedRoad, walkersOf } from '../lib/loracle.ts';
import { useAction, useAskAgain, useAskStone, useCrews, useShareWish, useWalk } from '../lib/queries.ts';
import {
  CareStill,
  ConsentLines,
  ConsentSheet,
  MAP_H,
  MAP_W,
  MORE,
  MarkDot,
  QuestRoll,
  ScrollSheet,
  SourcesFold,
  WaitInk,
  WaxSeal,
  emblemIcon,
  inkedLine,
  layoutPins,
  legPath,
  shortName,
  spanLine,
  useSpoken,
  useWriteChapter,
} from './loracle.tsx';
import { Scroll, Sigil } from './oracle.tsx';
import { ReportButton } from './report.tsx';
import { ErrorNote } from './ui.tsx';

const L = LORACLE_LINES;


// ---------------------------------------------------------------------------------- the dawn lane

/**
 * Screen 2b: the wish is written down; the stone reads it before the Lorer's next dawn. A crew member
 * reading someone's quest is told of the road, not of "yours".
 */
export function DawnWait({ mine = true }: { mine?: boolean }) {
  return (
    <Scroll as="section" className="ink-wait dawn-wait">
      <span className="dawn-moon" aria-hidden>
        <Sigil moon />
      </span>
      <WaitInk phase={0} still />
      <p className="wait-moon" role="status">
        <Moon size={22} aria-hidden className="dawn-moon-small" /> <span>{mine ? L.dawn : L.dawnCrew}</span>
      </p>
    </Scroll>
  );
}

// ---------------------------------------------------------------------------------- two roads

/** "First road", "Second road"… (the spec's carved tabs), then "Road 6". */
export function roadName(n: number): string {
  switch (n) {
    case 1:
      return L.road1;
    case 2:
      return L.road2;
    case 3:
      return L.road3;
    case 4:
      return L.road4;
    case 5:
      return L.road5;
    default:
      return fillLine(L.roadTab, { n });
  }
}

/** "Two roads", "Three roads"… then "6 roads". */
export function roadsTitle(count: number): string {
  switch (count) {
    case 2:
      return L.twoRoads;
    case 3:
      return L.threeRoads;
    case 4:
      return L.fourRoads;
    case 5:
      return L.fiveRoads;
    default:
      return fillLine(L.roadsCount, { n: count });
  }
}

/**
 * "Two roads": carved tabs above the scroll, one per road (First road, Second road…). The road the Lorer
 * walks (inked furthest) carries a small mark; a road still drawing says so; one waiting for dawn shows a
 * moon; one the fog or the stone's silence took says that. Arrow keys, Home and End move between them.
 * A crew member reading it is told whose quest keeps which road.
 */
export function RoadTabs({
  wish,
  roads,
  selected,
  onSelect,
  panelId,
}: {
  wish: Wish;
  roads: WishScroll[];
  selected: string;
  onSelect: (id: string) => void;
  panelId: string;
}) {
  const walked = walkedRoad(wish);
  const mine = isMine(wish);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const title = roadsTitle(roads.length);
  const go = (i: number) => {
    const k = (i + roads.length) % roads.length;
    onSelect(roads[k]!.id);
    refs.current[k]?.focus();
  };
  const onKey = (e: ReactKeyboardEvent, i: number) => {
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? roads.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    go(to);
  };
  return (
    <div className="road-tabs">
      <p className="roads-title" aria-hidden>
        {title}
      </p>
      <div role="tablist" className="road-tablist" aria-label={title}>
        {roads.map((r, i) => {
          const on = r.id === selected;
          const dawn = roadAtDawn(r);
          const drawing = roadInProgress(r) && !dawn;
          return (
            <button
              key={r.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`road-tab-${r.id}`}
              aria-selected={on}
              aria-controls={panelId}
              tabIndex={on ? 0 : -1}
              className={`btn carved road-tab${on ? ' on' : ''}`}
              onClick={() => onSelect(r.id)}
              onKeyDown={(e) => onKey(e, i)}
            >
              <span className="road-tab-name">{roadName(r.n)}</span>
              {drawing ? (
                <span className="road-tab-sub">{L.roadDrawing}</span>
              ) : dawn ? (
                <span className="road-tab-sub">
                  <Moon size={12} aria-hidden /> {L.roadAtDawn}
                </span>
              ) : r.status === 'faded' ? (
                <span className="road-tab-sub">{L.roadFaded}</span>
              ) : r.status === 'silent' ? (
                <span className="road-tab-sub">{L.roadSilent}</span>
              ) : r.id === walked.id && roadWalked(r) ? (
                <span className="road-tab-sub">
                  <Check size={12} strokeWidth={3} aria-hidden /> {mine ? L.roadYours : L.roadKept}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="roads-hint">{mine ? L.roadsHint : fillLine(L.roadsHintCrew, { name: wish.owner?.displayName ?? '' })}</p>
    </div>
  );
}

/** Consent taken back: the sheet comes up again before the stone reads anything new, then the deed goes on. */
function useConsentGate() {
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const consent = useAction(() => api.post<unknown>('/loracle/consent'), {
    onSuccess: () => {
      const run = retry;
      setRetry(null);
      run?.();
    },
  });
  return {
    check: (e: ApiError, again: () => void) => {
      if (e.code === 'consent') setRetry(() => again);
    },
    sheet: retry ? (
      <ConsentSheet pending={consent.isPending} error={consent.error} onYes={() => consent.mutate(undefined)} onNo={() => setRetry(null)} />
    ) : null,
  };
}

/** "Ask again": a stone button at the end of the scroll. Another road to the same wish; both are kept. */
export function AskAgain({ wish, onAsked }: { wish: Wish; onAsked: () => void }) {
  const gate = useConsentGate();
  const id = useId();
  const again = useAskAgain(wish.id, onAsked);
  const run = () => again.mutate(undefined, { onError: (e) => gate.check(e, run) });
  // in_progress here is a road still being drawn (the server's own words), not a question.
  const said = again.error?.code === 'in_progress' ? null : askRefusal(again.error);
  return (
    <section className="ask-again" aria-labelledby={id}>
      <p id={id} className="ask-again-hint">
        {L.askAgainHint}
      </p>
      {said ? (
        <p className="stone-line center" role="status">
          {said}
        </p>
      ) : (
        <ErrorNote error={again.error && again.error.code !== 'consent' ? again.error : null} />
      )}
      <button type="button" className={`btn btn-block stone-cast${again.isPending ? ' pending' : ''}`} disabled={again.isPending} onClick={run}>
        <Sigil />
        <span>{again.isPending ? L.listening : L.askAgain}</span>
      </button>
      {gate.sheet}
    </section>
  );
}

// ---------------------------------------------------------------------------------- ask the stone

/** The newest three signs of a deeper ask, the newest spoken politely (at most every 5 s, as the wait's). */
function AskSigns({ ask }: { ask: DeeperView }) {
  const signs = ask.signs.length ? ask.signs : [L.listening];
  const shown = signs.slice(-3);
  const spoken = useSpoken(signs[signs.length - 1]!);
  return (
    <>
      <ul className="wait-signs">
        {shown.map((s, i) => (
          <li key={signs.length - shown.length + i} className={`age-${shown.length - 1 - i}`}>
            {s}
          </li>
        ))}
      </ul>
      <p className="sr-only" aria-live="polite">
        {spoken}
      </p>
    </>
  );
}

/**
 * A deeper ask, pinned to its waypoint as a small scroll: the answer to the question if one was asked, a new
 * sign, real steps, the keeper, words to say on arrival, one new unknown, and where the stone looked. While
 * the stone reads: its signs; written down for dawn: the moon.
 */
export function DeeperScroll({ ask }: { ask: DeeperView }) {
  const a = ask.answer;
  return (
    <Scroll as="section" className={`deeper-scroll ${ask.status}`}>
      {ask.question && (
        <div className="deeper-part">
          <h4 className="sheet-h">{L.askYou}</h4>
          <p className="deeper-q">“{ask.question}”</p>
        </div>
      )}
      {ask.status === 'listening' ? (
        <AskSigns ask={ask} />
      ) : ask.status === 'dawn' ? (
        <p className="wait-moon" role="status">
          <Moon size={20} aria-hidden className="dawn-moon-small" /> <span>{L.askDawn}</span>
        </p>
      ) : ask.status === 'faded' ? (
        <p className="wait-fog">{L.askFaded}</p>
      ) : ask.status === 'silent' ? (
        <p className="wait-fog">{L.askSilent}</p>
      ) : a ? (
        <>
          {a.answer && (
            <div className="deeper-part">
              <h4 className="sheet-h">{L.askAnswer}</h4>
              <p className="deeper-answer">{a.answer}</p>
            </div>
          )}
          <div className="deeper-part">
            <h4 className="sheet-h">{L.askClue}</h4>
            <p className="deeper-clue">{a.clue}</p>
          </div>
          {a.steps.length > 0 && (
            <div className="deeper-part">
              <h4 className="sheet-h">{L.realRoad}</h4>
              <ol className="road-steps">
                {a.steps.map((s, i) => (
                  <li key={i}>
                    <span className={`step-kind ${s.kind}`}>{STEP_KIND_LABELS[s.kind]}</span>
                    <span className="step-text">
                      {s.text} <MarkDot mark={s.mark} />
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {a.keeper && (
            <div className="deeper-part">
              <h4 className="sheet-h">{L.keeper}</h4>
              <p>
                <strong>{a.keeper.name ?? a.keeper.role}</strong>
                {a.keeper.name ? `, ${a.keeper.role}` : ''} <MarkDot mark={a.keeper.mark} />
              </p>
              <p className="sheet-ask">{fillLine(MORE.askOf, { verb: a.keeper.verb })}</p>
            </div>
          )}
          {a.words && (
            <div className="deeper-part">
              <h4 className="sheet-h">{L.askWords}</h4>
              <p className="deeper-words">“{a.words}”</p>
            </div>
          )}
          <div className="deeper-part sheet-mystery">
            <h4 className="sheet-h">{L.askUnknown}</h4>
            <p>
              <em>{a.unknown}</em>
            </p>
          </div>
          <SourcesFold road={{ sources: ask.sources ?? [] }} />
        </>
      ) : null}
    </Scroll>
  );
}

/**
 * The refusals "Ask again" and "Ask the stone" answer in the stone's own words, read here so the owner's live
 * edits show (anything else: the server's message). 409 in_progress (one ask at a time per waypoint, or a
 * road still drawn), rest (the hidden daily limit), moon (past the owner's monthly ceiling); 503 asleep.
 */
export const askRefusal = (e: ApiError | null): string | null => {
  switch (e?.code) {
    case 'moon':
      return L.moonAsk;
    case 'in_progress':
      return L.askBusy;
    case 'rest':
      return L.rest;
    case 'asleep':
      return L.asleep;
    default:
      return null;
  }
};

/**
 * "Ask the stone about this", at the end of an open waypoint's sheet: an optional question (200 letters), a
 * short wait with the same signs, then a small scroll pinned to the waypoint for good. Past the soft budget
 * the question waits for dawn like a cast. If consent was taken back, the consent words come first. A
 * question at the care floor brings the care screen, as a cast does (nothing is stored or sent).
 */
export function AskStone({ wp, canAsk }: { wp: OpenWaypoint; canAsk: boolean }) {
  const asks = asksOf(wp);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [consenting, setConsenting] = useState(false);
  const [care, setCare] = useState<CareView | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const busyLine = useRef<HTMLParagraphElement>(null);
  const id = useId();
  // The control pressed is replaced: focus goes to what stands in its place (the busy line, or the opener).
  const refocus = () => requestAnimationFrame(() => (busyLine.current ?? opener.current)?.focus());
  const ask = useAskStone(wp.id, {
    asked: () => {
      setOpen(false);
      setQuestion('');
      refocus();
    },
    care: (c) => {
      setOpen(false);
      setQuestion('');
      setCare(c);
    },
  });
  const send = () => ask.mutate(question.trim() || null, { onError: (e) => e.code === 'consent' && setConsenting(true) });
  const consent = useAction(() => api.post<unknown>('/loracle/consent'), {
    onSuccess: () => {
      setConsenting(false);
      send();
    },
  });
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  // One ask at a time per waypoint, at dawn too (the server answers 409 in_progress otherwise).
  const waiting = asks.some((a) => a.status === 'listening' || a.status === 'dawn');
  const said = askRefusal(ask.error);
  if (!canAsk && !asks.length) return null;
  return (
    <section className="sheet-block ask-stone">
      {care ? (
        <CareStill
          care={care}
          onBack={() => {
            setCare(null);
            refocus();
          }}
        />
      ) : null}
      {canAsk &&
        !care &&
        (consenting ? (
          <div className="ask-consent">
            <p className="sheet-ask">{L.askConsent}</p>
            <ConsentLines />
            <ErrorNote error={consent.error} />
            <div className="sheet-actions">
              <button type="button" className={`btn wax-btn${consent.isPending ? ' pending' : ''}`} disabled={consent.isPending} onClick={() => consent.mutate(undefined)}>
                <Sigil />
                <span>{L.consentYes}</span>
              </button>
              <button type="button" className="btn ink-link" onClick={() => setConsenting(false)}>
                {L.consentNo}
              </button>
            </div>
          </div>
        ) : waiting ? (
          <p className="sheet-ask" ref={busyLine} tabIndex={-1}>
            {L.askBusy}
          </p>
        ) : open ? (
          <form
            className="ink-form ask-form"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <label htmlFor={id} className="ask-label">
              {L.askHint}
            </label>
            <textarea
              id={id}
              ref={field}
              className="parch-input"
              rows={2}
              maxLength={200}
              placeholder={L.askPlaceholder}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            {said ? <p className="sheet-ask">{said}</p> : <ErrorNote error={ask.error && ask.error.code !== 'consent' ? ask.error : null} />}
            <button className={`btn wax-btn${ask.isPending ? ' pending' : ''}`} disabled={ask.isPending}>
              <Sigil />
              <span>{ask.isPending ? L.listening : L.askStone}</span>
            </button>
            <button
              type="button"
              className="btn ink-link"
              onClick={() => {
                setOpen(false);
                refocus();
              }}
            >
              {L.askNotNow}
            </button>
          </form>
        ) : (
          <div className="sheet-actions">
            <button ref={opener} type="button" className="btn parch-btn ask-open" onClick={() => setOpen(true)}>
              {L.askStone}
            </button>
          </div>
        ))}
      {[...asks].reverse().map((a) => (
        <DeeperScroll key={a.id} ask={a} />
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------------- walk with you

const initial = (name: string) => ([...name.trim()][0] ?? '?').toUpperCase();

/** Who walks a waypoint, as small marks (initials pressed into parchment medallions). */
export function WalkerMarks({ walkers, decorative = false, max = 5 }: { walkers: UserSummary[]; decorative?: boolean; max?: number }) {
  if (!walkers.length) return null;
  const label = fillLine(L.walkersLabel, { names: walkers.map((u) => u.displayName).join(', ') });
  return (
    <span className="walker-marks" role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : label} aria-hidden={decorative || undefined}>
      <Footprints size={13} aria-hidden className="walker-steps" />
      {walkers.slice(0, max).map((u) => (
        <span key={u.id} className="walker-mark" aria-hidden>
          {initial(u.displayName)}
        </span>
      ))}
      {walkers.length > max && (
        <span className="walker-mark more" aria-hidden>
          +{walkers.length - max}
        </span>
      )}
    </span>
  );
}

/**
 * Who walks a waypoint, in its sheet. A crew member reading the quest can "Walk with {name}" on an open
 * waypoint (and walk no more); when the Lorer makes it a plan, the walkers are asked along to it. The
 * line that says you walk it is a polite status, always in the same place, and focus moves to the
 * button that took the pressed one's place.
 */
export function WalkSection({ wish, wp }: { wish: Wish; wp: OpenWaypoint }) {
  const mine = isMine(wish);
  const walkers = walkersOf(wp);
  const id = useId();
  const walk = useWalk(wp.id);
  const busy = walk.isPending;
  const walkRef = useRef<HTMLButtonElement>(null);
  const unwalkRef = useRef<HTMLButtonElement>(null);
  const focusSoon = (ref: { current: HTMLButtonElement | null }) => () => requestAnimationFrame(() => ref.current?.focus());
  const owner = wish.owner?.displayName;
  const canWalk = !mine && wp.state === 'open';
  if (mine && !walkers.length) return null;
  return (
    <section className="sheet-block sheet-walk" aria-labelledby={id}>
      <h3 id={id} className="sheet-h">
        {mine ? L.walkers : L.walkersCrew}
      </h3>
      {walkers.length ? (
        <p className="walk-who">
          <WalkerMarks walkers={walkers} decorative /> <span>{walkers.map((u) => u.displayName).join(', ')}</span>
        </p>
      ) : (
        <p className="sheet-ask">{L.nobodyYet}</p>
      )}
      {mine && wp.state === 'open' && <p className="sheet-ask">{wp.links.eventId ? L.walkersAsked : L.walkersPlan}</p>}
      <ErrorNote error={walk.error} />
      {canWalk && (
        <div className="sheet-actions">
          <p className="walk-line" role="status">
            {wp.walking && (
              <>
                <Footprints size={16} aria-hidden /> {L.walkingToo}
              </>
            )}
          </p>
          {wp.walking ? (
            <button ref={unwalkRef} type="button" className="btn ink-link" disabled={busy} onClick={() => walk.mutate(false, { onSuccess: focusSoon(walkRef) })}>
              {L.unwalk}
            </button>
          ) : (
            <>
              <button
                ref={walkRef}
                type="button"
                className={`btn wax-btn${busy ? ' pending' : ''}`}
                disabled={busy}
                onClick={() => walk.mutate(true, { onSuccess: focusSoon(unwalkRef) })}
              >
                <Footprints size={18} aria-hidden />
                <span>{owner ? fillLine(L.walkWith, { name: owner }) : L.walk}</span>
              </button>
              <p className="sheet-ask">{L.walkHint}</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** What phases B and C add at the end of a waypoint's sheet: the Lorer's deeper asks; who walks it. */
export function WaypointExtra({ wish, wp, canAsk }: { wish: Wish; wp: Waypoint; canAsk: boolean }) {
  if (wp.state === 'sealed') return null;
  return (
    <>
      {isMine(wish) && <AskStone wp={wp} canAsk={canAsk} />}
      {(sharedCrew(wish) || walkersOf(wp).length > 0) && <WalkSection wish={wish} wp={wp} />}
    </>
  );
}

// ---------------------------------------------------------------------------------- show to a crew

/** "{Crew} can see this scroll." in place of "Only you can see this scroll." */
export function CrewCanSee({ wish }: { wish: Wish }) {
  const crew = sharedCrew(wish);
  if (!crew) return null;
  return (
    <>
      <Users size={14} aria-hidden /> {fillLine(L.sharedWith, { crew: crew.name })}
    </>
  );
}

/** Show to one crew (only crews the Lorer is an active member of), or Only me. */
function CrewPicker({ wish, onClose }: { wish: Wish; onClose: () => void }) {
  const crews = useCrews();
  const mine = (crews.data ?? []).filter((c) => c.myStatus === 'active');
  const shown = sharedCrew(wish)?.id ?? null;
  const share = useShareWish(wish.id, onClose);
  const pick = (crewId: string | null) => share.mutate(crewId ? { audience: 'crew', crewId } : { audience: 'only_me', crewId: null });
  return (
    <ScrollSheet label={L.shareCrew} onClose={onClose}>
      <p className="share-hint">{L.shareHint}</p>
      <ul className="crew-picks">
        <li>
          <button type="button" className="btn parch-btn crew-pick" aria-pressed={!shown} disabled={share.isPending} onClick={() => pick(null)}>
            <Users size={18} aria-hidden className="crew-only" />
            <span>{L.shareOnlyMe}</span>
          </button>
        </li>
        {mine.map((c) => (
          <li key={c.id}>
            <button type="button" className="btn parch-btn crew-pick" aria-pressed={shown === c.id} disabled={share.isPending} onClick={() => pick(c.id)}>
              <span className="crew-emoji" aria-hidden>
                {c.emoji}
              </span>
              <span>{c.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {crews.data && !mine.length && (
        <div className="sheet-actions">
          <p className="share-hint">{L.shareNone}</p>
          <Link to="/crews/new" className="btn parch-btn">
            {L.shareGather}
          </Link>
        </div>
      )}
      {share.error?.code === 'removed' ? (
        <p className="share-hint" role="status">
          {L.shareRemoved}
        </p>
      ) : (
        <ErrorNote error={crews.error ?? share.error} />
      )}
    </ScrollSheet>
  );
}

/** The Lorer's own scroll: "Show to a crew", or, once shown, "Keep it to myself again". */
export function ShareLine({ wish }: { wish: Wish }) {
  const crew = sharedCrew(wish);
  const [picking, setPicking] = useState(false);
  const unshare = useShareWish(wish.id);
  return (
    <div className="quest-share">
      <ErrorNote error={unshare.error} />
      {crew ? (
        <button type="button" className="btn ink-link" disabled={unshare.isPending} onClick={() => unshare.mutate({ audience: 'only_me', crewId: null })}>
          {L.shareStop}
        </button>
      ) : (
        <button type="button" className="btn parch-btn share-open" onClick={() => setPicking(true)}>
          <Users size={17} aria-hidden />
          <span>{L.shareCrew}</span>
        </button>
      )}
      {picking && <CrewPicker wish={wish} onClose={() => setPicking(false)} />}
    </div>
  );
}

/** A crew member reading someone's quest: whose it is, and Report (D29; ReportButton hides it on your own). */
export function ViewerLine({ wish }: { wish: Wish }) {
  const owner = wish.owner ?? null;
  return (
    <div className="quest-share viewer">
      {owner && <p className="quest-shown-by">{fillLine(L.shownBy, { name: owner.displayName })}</p>}
      <ReportButton targetType="quest" targetId={wish.id} subject={owner ? { id: owner.id, displayName: owner.displayName } : null} variant="link" />
    </div>
  );
}

/** Quests other Lorers showed to my crews, as rolled scrolls (newest shown first, at most 30: the server's cap). */
export function CrewQuestLog({ quests }: { quests: CrewQuestSummary[] }) {
  return (
    <ol className="quest-log crew-quests">
      {quests.map((w) => (
        <li key={w.id}>
          <QuestRoll w={w} sub={fillLine(L.shownLine, { name: w.owner.displayName, crew: w.crew.name })} />
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------------- the epic

const inked = (wp: EpicWaypoint) => wp.inkedOn !== null;

/**
 * The epic's map: the same true-shape ink map, where every inked line (the leg that reached a waypoint) and
 * its pin lead to the chapter written for it. Decoration for sighted readers (aria-hidden); the chronicle
 * below is the same map in words, with the same links.
 */
export function EpicMap({ map, onPick }: { map: EpicWaypoint[]; onPick: (wp: EpicWaypoint) => void }) {
  const { pins, drawnPath } = layoutPins(map);
  return (
    <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className={`true-map epic-map${drawnPath ? ' drawn-path' : ''}`} aria-hidden>
      <rect x="4" y="4" width={MAP_W - 8} height={MAP_H - 8} className="map-frame" />
      <rect x="9" y="9" width={MAP_W - 18} height={MAP_H - 18} className="map-frame thin" />
      <g className="map-rose" transform={`translate(${MAP_W - 26} 30)`}>
        <path d="M0 -13 L3.2 0 L0 13 L-3.2 0Z" />
        <path d="M-9 0 L0 -2.4 L9 0 L0 2.4Z" className="map-rose-light" />
        <text y="-16">N</text>
      </g>
      {pins.slice(1).map((b, k) => {
        const a = pins[k]!;
        const sea = a.wp.where.precision === 'sea' || b.wp.where.precision === 'sea';
        const d = legPath(a, b, sea);
        const linked = inked(b.wp) && !!b.wp.chapter;
        return (
          <g key={b.wp.id} className={`epic-leg${linked ? ' linked' : ''}`} onClick={linked ? () => onPick(b.wp) : undefined}>
            <path d={d} className={`map-road${sea ? ' sea' : ''}${inked(b.wp) ? ' inked' : ''}`} />
            {linked && <path d={d} className="epic-hit" />}
          </g>
        );
      })}
      {pins.map((p) => {
        const Icon = emblemIcon(p.wp.emblem);
        const ring = p.wp.where.precision === 'town' || p.wp.where.precision === 'country';
        const state = inked(p.wp) ? 'inked' : 'open';
        return (
          <g
            key={p.wp.id}
            className={`map-pin ${state}${p.wp.chapter ? ' linked' : ''}`}
            transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
            onClick={() => onPick(p.wp)}
          >
            {ring && <circle r="19.5" className="map-ring" />}
            <circle r="14.5" className="map-medal" />
            <Icon x={-8} y={-8} size={16} strokeWidth={2.2} className="map-icon" />
            {state === 'inked' && <path d="M6 -16 l3.5 3.5 7 -8" className="map-check" />}
            <text x="-15" y="-13" className="map-num">
              {p.i + 1}
            </text>
            <text y="29" className="map-name">
              {shortName(p.wp.name)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** "Write the chapter" for an inked waypoint that has none yet (the Lorer's own epic only). */
function EpicWrite({ wp }: { wp: EpicWaypoint }) {
  const chapter = useWriteChapter({ id: wp.id, name: wp.name, inkedOn: wp.inkedOn, where: wp.where, note: null });
  return (
    <>
      <ErrorNote error={chapter.error} />
      <button type="button" className={`btn ink-link epic-write${chapter.isPending ? ' pending' : ''}`} disabled={chapter.isPending} onClick={() => chapter.mutate(undefined)}>
        {L.writeChapter}
      </button>
    </>
  );
}

/**
 * The Epic: a wish come true, told as its map (the road walked furthest). Every inked line leads to its
 * chapter; under the map, the chronicle in words (the accessible twin): each waypoint, the day it was
 * inked, who walked it, its chapter. A crew member it was shown to reads the same epic, with only the
 * chapters they may read.
 */
export function EpicScroll({ epic }: { epic: EpicView }) {
  const navigate = useNavigate();
  const listRef = useRef<HTMLOListElement>(null);
  const pick = (wp: EpicWaypoint) => {
    if (wp.chapter) {
      navigate(`/chapters/${wp.chapter.id}`);
      return;
    }
    listRef.current?.querySelector<HTMLElement>(`[data-wp="${wp.id}"]`)?.scrollIntoView({ block: 'center' });
  };
  return (
    <Scroll as="article" className="quest-scroll fulfilled epic-scroll">
      <p className="scroll-kicker epic-kicker">{L.epic}</p>
      <h2 className="quest-title">{epic.title ?? epic.text}</h2>
      {epic.span && <p className="quest-span no-drop">{spanLine(epic.span)}</p>}
      <div className="ink-rule" aria-hidden />
      <p className="quest-state lore">{MORE.fulfilledLine}</p>
      {epic.calling && <p className="quest-calling-text">{epic.calling}</p>}
      {epic.truth && <p className="quest-truth">{epic.truth}</p>}
      {epic.map.length > 0 && (
        <section className="quest-section" aria-labelledby="epic-map">
          <h3 id="epic-map" className="scroll-kicker">
            {L.map}
          </h3>
          <p className="epic-line">{epic.mine ? L.epicLine : fillLine(L.epicLineCrew, { name: epic.owner.displayName })}</p>
          <EpicMap map={epic.map} onPick={pick} />
          <ol className="epic-chronicle" ref={listRef}>
            {epic.map.map((wp, i) => (
              <li key={wp.id} data-wp={wp.id} className={`epic-entry${inked(wp) ? ' inked' : ''}`}>
                <WaxSeal emblem={wp.emblem} tone={inked(wp) ? 'inked' : 'open'} />
                <div className="epic-text">
                  <p className="wp-name">
                    <span className="wp-n">{i + 1}.</span> {wp.name}
                  </p>
                  <p className="epic-when">{inked(wp) ? inkedLine(wp.inkedOn) : L.epicUnwalked}</p>
                  {wp.walkers.length > 0 && <p className="epic-walked">{fillLine(L.epicWalkedWith, { names: wp.walkers.map((u) => u.displayName).join(', ') })}</p>}
                  {wp.chapter ? (
                    <Link to={`/chapters/${wp.chapter.id}`} className="epic-chapter">
                      <BookOpen size={15} aria-hidden /> {wp.chapter.title || MORE.readChapter}
                    </Link>
                  ) : epic.mine && inked(wp) ? (
                    <EpicWrite wp={wp} />
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
      {epic.crew && (
        <p className="quest-only">
          <Users size={14} aria-hidden /> {fillLine(L.sharedWith, { crew: epic.crew.name })}
        </p>
      )}
      <Link to={`/oracle/quest/${epic.id}`} className="btn ink-link epic-back">
        {L.epicBack}
      </Link>
    </Scroll>
  );
}
