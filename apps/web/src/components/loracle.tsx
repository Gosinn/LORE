// The Loracle: a Lorer speaks a wish, the stones answer with a road. Carved stone for everything
// you touch, parchment for everything the stone says, red wax for anything sealed or final, ember
// the only light (the stone-and-scroll look of the ORACLE block in app.css). Every word on these
// screens comes from LORACLE_LINES (or MORE below); the mind only ever writes the scroll itself.
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Anchor,
  Bell,
  BookOpen,
  Bridge,
  Castle,
  Check,
  ChevronDown,
  Compass,
  Crown,
  DoorOpen,
  Eye,
  Feather,
  Flame,
  Hand,
  HandFist,
  House,
  Key,
  Leaf,
  Lock,
  MapPin,
  Moon,
  Mountain,
  Music,
  Plane,
  Route,
  Search,
  Ship,
  Snowflake,
  Soup,
  Star,
  Sun,
  Sword,
  Tent,
  TrainFront,
  TreePine,
  Waves,
  Wine,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router';
import {
  AGE_BAND_LABELS,
  AGE_BANDS,
  CALLING_LABELS,
  CALLINGS,
  LORACLE_LINES,
  MARK_LABELS,
  MONEY_BAND_LABELS,
  MONEY_BANDS,
  NO_LIMIT_KM,
  PROVISION_GROUPS,
  stripMarkers,
  PROVISION_LABELS,
  ROAD_IN_PROGRESS,
  STEP_KIND_LABELS,
  TIME_BAND_LABELS,
  TIME_BANDS,
  WAIT_PHASE_LABELS,
  WAIT_PHASES,
  copy,
  fillLine,
  type AgeBand,
  type Calling,
  type CareView,
  type ChapterDetail,
  type Emblem,
  type GeocodeResult,
  type LoracleContext,
  type LoracleSettings,
  type Mark,
  type MoneyBand,
  type OpenWaypoint,
  type QuestSpan,
  type TimeBand,
  type Waypoint,
  type WaypointWhere,
  type Wish,
  type WishScroll,
  type WishSummary,
} from '#shared';
import { api, ApiError, isNative, qs } from '../lib/api.ts';
import { localTimeZone, todayISO } from '../lib/dates.ts';
import { useAction } from '../lib/queries.ts';
import { ensureReminderPermission } from '../lib/reminders.ts';
import { Embers, RuneRow, Scroll, Sigil, StoneCircle } from './oracle.tsx';
import { ErrorNote, FOCUSABLE } from './ui.tsx';

const L = LORACLE_LINES;

/**
 * Words these screens need that LORACLE_LINES does not carry (yet). Same voice: ancient, simple, true.
 * Candidates to move into packages/shared/src/vocabulary.ts → LORACLE_LINES.
 */
// copy:table
export const MORE = {
  realmPlaceholder: 'Your town',
  realmSearch: 'Seek the town',
  realmNone: 'The stones know no town by that name. Try a bigger one nearby.',
  realmFirst: 'Now tell the stones where you stand.',
  realmKeep: 'Keep my town',
  realmNoCountry: 'The stones cannot tell which land that town is in. Choose a bigger town nearby.',
  passportSame: 'Same as the land where I stand',
  examplesTake: 'Take up this wish',
  logListening: 'The stone is drawing it.',
  logMoon: 'Written down. It will be read at the new moon.',
  logFaded: 'The fog won. Try again when you like.',
  logSilent: 'The stone was silent on this one.',
  minutes: 'About {minutes} minutes.',
  inWeek: 'It is in your week.',
  seeNotes: 'See it in your notes',
  day: 'Day',
  time: 'Hour',
  setIt: 'Set it there',
  openPlan: 'Open the plan',
  inVault: 'In your vault',
  readChapter: 'Read the chapter',
  inkedOn: 'Inked {date}.',
  inked: 'Inked.',
  inkDay: 'The day you did it',
  legend: 'old lore',
  askOf: 'Ask them to {verb}.',
  waypoint: 'Waypoint {n}',
  burnIt: 'Burn it',
  keepIt: 'Keep it',
  fulfilledLine: 'This wish came true. It is lore now.',
  letGoLine: 'You let this one go. It waits, rolled up, if you want it again.',
  sayAgain: 'Speak it again',
  privacyMore: 'Read the whole of it in the privacy policy.',
  consentWithdrawn: 'The stone no longer reads your wishes. Your scrolls stay.',
  onlyYouAll: 'Only you can see your wishes and your scrolls.',
  close: 'Close',
} as const;

// ---------------------------------------------------------------------------------- emblems & wax

const EMBLEM_ICONS: Record<Emblem, LucideIcon> = {
  fist: HandFist,
  blade: Sword,
  ship: Ship,
  anchor: Anchor,
  wave: Waves,
  mountain: Mountain,
  snow: Snowflake,
  sun: Sun,
  moon: Moon,
  star: Star,
  flame: Flame,
  tree: TreePine,
  leaf: Leaf,
  road: Route,
  bridge: Bridge,
  door: DoorOpen,
  key: Key,
  bell: Bell,
  book: BookOpen,
  cup: Wine,
  crown: Crown,
  eye: Eye,
  compass: Compass,
  tower: Castle,
  house: House,
  music: Music,
  tent: Tent,
  plane: Plane,
  train: TrainFront,
  bowl: Soup,
  feather: Feather,
  hand: Hand,
};

export const emblemIcon = (emblem: Emblem | null | undefined): LucideIcon => (emblem && EMBLEM_ICONS[emblem]) || Compass;

export type SealTone = 'wax' | 'open' | 'inked' | 'gold' | 'stone';

/** A wax disc with the waypoint's emblem pressed into it (or a parchment medallion while it is open). */
export function WaxSeal({ emblem, tone = 'wax', className = '' }: { emblem: Emblem | null; tone?: SealTone; className?: string }) {
  const Icon = emblemIcon(emblem);
  return (
    <span className={`wax-seal ${tone} ${className}`} aria-hidden>
      <Icon size={18} strokeWidth={2} />
      {tone === 'inked' && (
        <span className="wax-check">
          <Check size={11} strokeWidth={3.5} />
        </span>
      )}
    </span>
  );
}

/** Marks instead of hedges: a wax dot (whole, cracked, faded with its year, struck or split). Tapping shows its sources. */
export function MarkDot({ mark }: { mark: Mark | null }) {
  const [open, setOpen] = useState(false);
  if (!mark) return null;
  const label = fillLine(MARK_LABELS[mark.status], { year: mark.year ?? '' }).trim();
  const sources = mark.sources.length ? `${mark.sources.length === 1 ? copy('source') : copy('sources')} ${mark.sources.join(', ')}` : '';
  return (
    <span className="mark-wrap">
      <button
        type="button"
        className={`mark mark-${mark.status}`}
        aria-label={sources ? `${label}: ${sources}` : label}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <i aria-hidden />
      </button>
      {mark.status === 'stale' && mark.year && (
        <span className="mark-year" aria-hidden>
          {mark.year}
        </span>
      )}
      {open && (
        <span className="mark-note">
          {label}
          {sources && ` · ${sources}`}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------------- the stone

/** The header stone: "These stones see what you do not". It speaks while a wish is cast, goes still for care, sleeps without a key. */
export function StoneHeader({ speaking = false, still = false, asleep = false }: { speaking?: boolean; still?: boolean; asleep?: boolean }) {
  const lit = speaking && !still && !asleep;
  return (
    <section className={`oracle-stone${lit ? ' speaking sunk' : ''}${still ? ' still' : ''}${asleep ? ' asleep' : ''}`}>
      <RuneRow active={lit} />
      <div className="stone-window">
        <StoneCircle active={lit} />
        {!still && !asleep && <Embers active={lit} />}
      </div>
      <h1>{L.header}</h1>
      {!still && !asleep && <p>{L.headerSub}</p>}
      <RuneRow active={lit} className="runes-low" />
    </section>
  );
}

export function AsleepStone() {
  return (
    <section className="stone-tablet asleep-stone" role="status">
      <Sigil moon />
      <p>{L.asleep}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------------- sheets

/**
 * A parchment sheet rising from the bottom (a dialog on wide screens). Focus is trapped inside and
 * returned to what opened it; Escape, the close button, a tap outside or a swipe down closes it.
 * It is portalled to <body> but carries .oracle-page, so it keeps the stone's colours (and the crazy
 * theme leaves it unpainted).
 */
export function ScrollSheet({ label, title, onClose, children }: { label: string; title?: ReactNode; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const start = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);
  const headId = useId();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>('[data-autofocus]');
    (first ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (!items.length) return;
      const a = items[0]!;
      const z = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === a || document.activeElement === node || !node.contains(document.activeElement))) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && (document.activeElement === z || !node.contains(document.activeElement))) {
        // Also when focus fell out of the sheet (a pressed control React replaced): back to its start.
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const swipe = {
    onTouchStart: (e: ReactTouchEvent) => {
      start.current = e.touches[0]?.clientY ?? null;
    },
    onTouchMove: (e: ReactTouchEvent) => {
      if (start.current === null) return;
      setDrag(Math.max(0, (e.touches[0]?.clientY ?? start.current) - start.current));
    },
    onTouchEnd: () => {
      start.current = null;
      if (drag > 90) close.current();
      else setDrag(0);
    },
  };

  return createPortal(
    <div className="oracle-page loracle-overlay" onMouseDown={(e) => e.target === e.currentTarget && close.current()}>
      <div
        ref={ref}
        className="parch-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headId}
        tabIndex={-1}
        style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}
      >
        <div className="sheet-grip" aria-hidden {...swipe} />
        <div className="parch-sheet-head" {...swipe}>
          <h2 id={headId} aria-label={label}>
            {title ?? label}
          </h2>
          <button type="button" className="sheet-close" onClick={() => close.current()} aria-label={MORE.close}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Lines like "What never goes: …" keep their lead words in bold. */
function leadLine(line: string) {
  const i = line.indexOf(':');
  if (i < 0 || i > 90) return <>{line}</>;
  return (
    <>
      <strong>{line.slice(0, i + 1)}</strong>
      {line.slice(i + 1)}
    </>
  );
}

/** What goes, what never goes, what LORE keeps: the consent sheet's words (also shown inside a waypoint's sheet). */
export function ConsentLines() {
  return (
    <>
      <ul className="consent-lines">
        <li>{leadLine(L.consentGoes)}</li>
        <li>{leadLine(L.consentNever)}</li>
        <li>{leadLine(L.consentUse)}</li>
        <li>{leadLine(L.consentKeeps)}</li>
      </ul>
      <p className="consent-more">
        <Link to="/privacy">{MORE.privacyMore}</Link>
      </p>
    </>
  );
}

/** Before the first wish leaves for Anthropic (Apple guideline 5.1.2(i)): what goes, what never goes, what LORE keeps. */
export function ConsentSheet({ onYes, onNo, pending, error }: { onYes: () => void; onNo: () => void; pending: boolean; error: unknown }) {
  return (
    <ScrollSheet label={L.consentTitle} onClose={onNo}>
      <ConsentLines />
      <ErrorNote error={error} />
      <div className="sheet-actions">
        <button type="button" className={`btn wax-btn${pending ? ' pending' : ''}`} onClick={onYes} disabled={pending}>
          <Sigil />
          <span>{L.consentYes}</span>
        </button>
        <button type="button" className="btn ink-link" onClick={onNo}>
          {L.consentNo}
        </button>
      </div>
    </ScrollSheet>
  );
}

// ---------------------------------------------------------------------------------- the stone's questions

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' });
  } catch {
    return null;
  }
})();

/** "IS" → "Iceland". Names that aren't two-letter codes are shown as they are. */
export function countryName(code: string | null | undefined): string {
  if (!code) return '';
  if (!/^[A-Z]{2}$/.test(code)) return code;
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

// Countries that issue passports (ISO 3166-1 alpha-2, plus XK), for "Your passport".
// copy:ignore (country codes)
const PASSPORT_CODES =
  'AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(
    ' ',
  );
let passportOptions: { code: string; name: string }[] | null = null;
const passports = () =>
  (passportOptions ??= PASSPORT_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name)));

/**
 * "Where do you stand?": the town search (OpenStreetMap through our server). Only the town's name and
 * its country ever reach the stone's mind; the point stays on LORE's server.
 */
export function RealmAsk({ onDone, onCancel, autoFocus = false }: { onDone?: () => void; onCancel?: () => void; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const inputId = useId();
  // A search is a read: it shouldn't refresh everything on screen the way a write (useAction) does.
  const search = useMutation<GeocodeResult[], ApiError, string>({
    mutationFn: (query) => api.get<GeocodeResult[]>(`/oracle/geocode${qs({ q: query })}`),
    onSuccess: setResults,
  });
  const save = useAction(
    (r: GeocodeResult) =>
      api.put<LoracleSettings>('/loracle/settings', {
        home: { label: r.label, lat: r.lat, lon: r.lon, country: r.country ?? null },
        timeZone: localTimeZone(),
      }),
    { onSuccess: () => onDone?.() },
  );

  return (
    <div className="realm-ask">
      <form
        className="row"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length >= 2) search.mutate(q.trim());
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          {MORE.realmPlaceholder}
        </label>
        <input
          id={inputId}
          className="input grow"
          placeholder={MORE.realmPlaceholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={120}
          autoComplete="address-level2"
          autoFocus={autoFocus}
        />
        <button className="btn carved realm-search" disabled={search.isPending || q.trim().length < 2} aria-label={MORE.realmSearch}>
          <Search size={18} />
        </button>
      </form>
      <ErrorNote error={search.error ?? save.error} />
      {results &&
        (results.length ? (
          <div className="list">
            {results.map((r) => (
              <button
                key={`${r.lat},${r.lon}`}
                type="button"
                className="list-item realm-result"
                disabled={save.isPending}
                onClick={() => save.mutate(r)}
              >
                <MapPin size={16} />
                <span className="grow">
                  {r.label}
                  {r.country && !r.label.includes(countryName(r.country)) ? `, ${countryName(r.country)}` : ''}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="small">{MORE.realmNone}</p>
        ))}
      {onCancel && (
        <button type="button" className="btn ghost-carve" onClick={onCancel}>
          {MORE.realmKeep}
        </button>
      )}
    </div>
  );
}

// How far the stones may send you, in km. Steps keep short distances precise; the last is ANYWHERE.
const REACH_STEPS: number[] = [];
for (let km = 10; km <= 1000; km += km < 100 ? 10 : km < 300 ? 25 : 50) REACH_STEPS.push(km);
REACH_STEPS.push(1500, 2000, 3000, 5000, 10000, NO_LIMIT_KM);
const fmtReach = (km: number) => (km >= NO_LIMIT_KM ? L.reachAnywhere : `${km.toLocaleString('en')} km`);
/** The stops, plus the saved distance if it isn't one of them, so the slider never moves by itself. */
const reachSteps = (saved: number) => (REACH_STEPS.includes(saved) ? REACH_STEPS : [...REACH_STEPS, saved].sort((a, b) => a - b));

/** "How far will you go?": the carved groove, ending in ANYWHERE. */
export function ReachSlider({ km, onChange }: { km: number; onChange: (km: number) => void }) {
  const [steps] = useState(() => reachSteps(km));
  const id = useId();
  const step = Math.max(0, steps.indexOf(km));
  return (
    <div className="realm-distance">
      <label htmlFor={id} className="realm-km">
        {L.reachAsk} <b>{fmtReach(km)}</b>
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={steps.length - 1}
        step={1}
        value={step}
        onChange={(e) => onChange(steps[Number(e.target.value)]!)}
        aria-valuetext={fmtReach(km)}
        className="range"
        style={{ '--fill': `${(step / (steps.length - 1)) * 100}%` } as CSSProperties}
      />
      <p className="realm-far">{km >= NO_LIMIT_KM ? L.reachHintAnywhere : L.reachHint}</p>
    </div>
  );
}

/** "What calls to you?": quest-shaped callings, small carved stones that sink and light when chosen. */
export function CallingStones({ value, onChange }: { value: Calling[]; onChange: (v: Calling[]) => void }) {
  const toggle = (c: Calling) => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]);
  return (
    <div className="chips wrap calling-stones">
      {CALLINGS.map((c) => {
        const Icon = emblemIcon(CALLING_LABELS[c].emblem);
        return (
          <button key={c} type="button" className="chip" aria-pressed={value.includes(c)} onClick={() => toggle(c)}>
            <Icon size={15} aria-hidden className="chip-icon" /> {CALLING_LABELS[c].label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * "How far will you go?" where the Lorer sees it: the slider, kept a moment after it stops moving
 * (a cast doesn't carry it). ANYWHERE unless the Lorer chooses less.
 */
export function ReachAsk({ settings }: { settings: LoracleSettings }) {
  const [reach, setReach] = useState(settings.radiusKm);
  const save = useAction((km: number) => api.put<LoracleSettings>('/loracle/settings', { radiusKm: km }));
  const saved = useRef(settings.radiusKm);
  useEffect(() => {
    if (reach === saved.current) return;
    const t = setTimeout(() => {
      saved.current = reach;
      save.mutate(reach);
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reach]);
  return (
    <div className="know-q">
      <ReachSlider km={reach} onChange={setReach} />
      <ErrorNote error={save.error} />
    </div>
  );
}

/**
 * "What the stone should know": where you stand, and what you choose to tell about yourself. All
 * optional, remembered privately. The context also travels with each cast.
 */
export function KnowFold({
  settings,
  ctx,
  setCtx,
}: {
  settings: LoracleSettings;
  ctx: LoracleContext;
  setCtx: (c: LoracleContext) => void;
}) {
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const foldId = useId();
  const realm = settings.realm;
  const keep = useAction(() => api.put<LoracleSettings>('/loracle/settings', { context: ctx }), {
    onSuccess: () => setOpen(false),
  });

  const set = <K extends keyof LoracleContext>(k: K, v: LoracleContext[K]) => setCtx({ ...ctx, [k]: v });

  return (
    <div className="know">
      <button type="button" className="know-toggle" aria-expanded={open} aria-controls={foldId} onClick={() => setOpen(!open)}>
        <span>{L.knowAsk}</span>
        <ChevronDown size={18} aria-hidden className="know-chevron" />
      </button>
      <div id={foldId} className="know-fold" hidden={!open}>
        <p className="small">{L.knowHint}</p>

        {realm && (
          <div className="know-q">
            <p className="label">{L.realmAsk}</p>
            {changing ? (
              <RealmAsk autoFocus onDone={() => setChanging(false)} onCancel={() => setChanging(false)} />
            ) : (
              <div className="row banner realm-line">
                <MapPin size={16} />
                <strong className="grow">
                  {realm.label}
                  {realm.country && !realm.label.includes(countryName(realm.country)) ? `, ${countryName(realm.country)}` : ''}
                </strong>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChanging(true)}>
                  {L.realmChange}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="know-grid">
          <label className="know-field">
            <span className="label">{L.ageAsk}</span>
            <select className="input" value={ctx.age ?? ''} onChange={(e) => set('age', (e.target.value || null) as AgeBand | null)}>
              <option value="">{L.ageNone}</option>
              {AGE_BANDS.map((a) => (
                <option key={a} value={a}>
                  {AGE_BAND_LABELS[a]}
                </option>
              ))}
            </select>
          </label>
          <label className="know-field">
            <span className="label">{L.moneyAsk}</span>
            <select className="input" value={ctx.money ?? ''} onChange={(e) => set('money', (e.target.value || null) as MoneyBand | null)}>
              <option value="">{L.ageNone}</option>
              {MONEY_BANDS.map((m) => (
                <option key={m} value={m}>
                  {MONEY_BAND_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="know-field">
            <span className="label">{L.timeAsk}</span>
            <select className="input" value={ctx.time ?? ''} onChange={(e) => set('time', (e.target.value || null) as TimeBand | null)}>
              <option value="">{L.ageNone}</option>
              {TIME_BANDS.map((t) => (
                <option key={t} value={t}>
                  {TIME_BAND_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="know-field">
            <span className="label">{L.passportAsk}</span>
            <select className="input" value={ctx.passport ?? ''} onChange={(e) => set('passport', e.target.value || null)}>
              <option value="">
                {MORE.passportSame}
                {realm?.country ? ` (${countryName(realm.country)})` : ''}
              </option>
              {passports().map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="know-field wide">
            <span className="label">{L.bodyAsk}</span>
            <input
              className="input"
              maxLength={80}
              placeholder={L.bodyPlaceholder}
              value={ctx.body ?? ''}
              onChange={(e) => set('body', e.target.value || null)}
            />
          </label>
          <label className="know-field wide">
            <span className="label">{L.languagesAsk}</span>
            <input
              className="input"
              maxLength={80}
              placeholder={L.languagesPlaceholder}
              value={ctx.languages ?? ''}
              onChange={(e) => set('languages', e.target.value || null)}
            />
          </label>
        </div>

        <ErrorNote error={keep.error} />
        <button type="button" className="btn carved know-keep" disabled={keep.isPending} onClick={() => keep.mutate(undefined)}>
          {L.save}
        </button>
      </div>
    </div>
  );
}

/** True when a wish says more than "I wish" (the same test the server makes). */
export const saysSomething = (wish: string) =>
  wish
    .replace(/^\s*i\s+wish\b/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '').length >= 2;

/**
 * Speak: the stone asks, the Lorer answers in one big serif field ("I wish …"). The runes under it
 * glow brighter as the wish grows; five example scrolls fill the field (never cast it).
 */
export function WishWell({
  settings,
  examples,
  text,
  setText,
  ctx,
  setCtx,
  onCast,
  pending,
  line,
  error,
}: {
  settings: LoracleSettings;
  examples: string[];
  text: string;
  setText: (t: string) => void;
  ctx: LoracleContext;
  setCtx: (c: LoracleContext) => void;
  onCast: () => void;
  pending: boolean;
  line: string | null;
  error: unknown;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const realm = settings.realm;
  const ready = saysSomething(text) && !!realm;
  const said = Math.max(0, text.trim().length - L.wishStart.trim().length);
  const glow = 0.15 + 0.85 * Math.min(1, said / 160);

  // The field grows with the wish.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [text]);

  const caretToEnd = () => {
    const el = field.current;
    if (!el) return;
    requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
  };
  const take = (example: string) => {
    setText(example);
    field.current?.focus();
    caretToEnd();
  };

  return (
    <section className="stone-tablet wish-well" aria-labelledby={`${fieldId}-ask`}>
      <h2 id={`${fieldId}-ask`} className="well-ask">
        {L.teaser}
      </h2>
      <p className="well-sub">
        {L.headline} {L.sub}
      </p>

      <div className="wish-slot">
        <label htmlFor={fieldId} className="sr-only">
          {L.wishLabel}
        </label>
        <textarea
          id={fieldId}
          ref={field}
          className="wish-field"
          value={text}
          rows={2}
          maxLength={400}
          spellCheck
          enterKeyHint="go"
          onFocus={() => text.trim() === L.wishStart.trim() && caretToEnd()}
          onChange={(e) => setText(e.target.value.replace(/\s*\n+\s*/g, ' '))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (ready && !pending) onCast();
            }
          }}
        />
      </div>
      <RuneRow className="wish-runes" style={{ '--rune-glow': glow.toFixed(3) } as CSSProperties} />

      <div className="wish-examples">
        <p className="examples-kicker">{L.examples}</p>
        <ul>
          {examples.slice(0, 5).map((ex, i) => (
            <li key={i}>
              <button type="button" className="example-scroll" onClick={() => take(ex)} aria-label={`${MORE.examplesTake}: ${ex}`}>
                {ex}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {!realm && (
        <div className="realm-first">
          <p className="label">{L.realmAsk}</p>
          <p className="small">{L.realmHint}</p>
          <RealmAsk />
        </div>
      )}

      <ReachAsk settings={settings} />

      <div className="know-q">
        <p className="label">{L.callingsAsk}</p>
        <p className="small">{L.callingsHint}</p>
        <CallingStones value={ctx.callings} onChange={(v) => setCtx({ ...ctx, callings: v })} />
      </div>

      <KnowFold settings={settings} ctx={ctx} setCtx={setCtx} />

      {line && (
        <p className="stone-line" role="status">
          {line}
        </p>
      )}
      <ErrorNote error={error} />
      <button type="button" className={`btn btn-block stone-cast${pending ? ' pending' : ''}`} disabled={!ready || pending} onClick={onCast}>
        <Sigil />
        <span>{pending ? L.listening : L.cast}</span>
      </button>
      {!realm && <p className="cast-need">{MORE.realmFirst}</p>}
      <p className="well-privacy">
        <Lock size={13} aria-hidden /> {L.privacy}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------------- riddle, reroute, care

/** A wish too vague to draw: the stone asks one riddle back. Three pebbles, or the Lorer's own words. */
export function RiddleStones({
  riddle,
  onAnswer,
  onBack,
  pending,
  error,
}: {
  riddle: { question: string; options: string[] };
  onAnswer: (a: string) => void;
  onBack: () => void;
  pending: boolean;
  error: unknown;
}) {
  const [own, setOwn] = useState('');
  const id = useId();
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => head.current?.focus(), [riddle.question]);
  return (
    <section className="stone-tablet riddle-stones" aria-labelledby={`${id}-q`}>
      <h2 id={`${id}-q`} ref={head} className="riddle-q" tabIndex={-1}>
        {riddle.question}
      </h2>
      <div className="pebbles">
        {riddle.options.slice(0, 3).map((o) => (
          <button key={o} type="button" className="pebble" disabled={pending} onClick={() => onAnswer(o)}>
            {o}
          </button>
        ))}
      </div>
      <form
        className="riddle-own"
        onSubmit={(e) => {
          e.preventDefault();
          if (own.trim()) onAnswer(own.trim());
        }}
      >
        <label htmlFor={id} className="label">
          {L.riddleOwn}
        </label>
        <div className="row">
          <input id={id} className="input grow" maxLength={80} value={own} onChange={(e) => setOwn(e.target.value)} />
          <button className="btn carved" disabled={pending || !own.trim()}>
            {L.cast}
          </button>
        </div>
      </form>
      <ErrorNote error={error} />
      <button type="button" className="btn ghost-carve" onClick={onBack}>
        {L.rerouteLet}
      </button>
    </section>
  );
}

/** The stone won't draw that road, and names the honest wish under it. */
export function RerouteOffer({ offer, onCast, onLet, pending, error }: { offer: string; onCast: () => void; onLet: () => void; pending: boolean; error: unknown }) {
  const [before = '', after = ''] = L.rerouteOffer.split('{offer}');
  const id = useId();
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => head.current?.focus(), [offer]);
  return (
    <section className="stone-tablet reroute-offer" aria-labelledby={id}>
      <h2 id={id} ref={head} tabIndex={-1}>
        {L.reroute}
      </h2>
      <p className="small">{before.trim()}</p>
      <Scroll className="offer-scroll">
        <p>{offer}</p>
      </Scroll>
      <p className="small">{after.trim()}</p>
      <ErrorNote error={error} />
      <button type="button" className={`btn btn-block stone-cast${pending ? ' pending' : ''}`} disabled={pending} onClick={onCast}>
        <Sigil />
        <span>{pending ? L.listening : L.rerouteCast}</span>
      </button>
      <button type="button" className="btn ghost-carve" onClick={onLet}>
        {L.rerouteLet}
      </button>
    </section>
  );
}

/** Signs of self-harm: no runes, no map, no ink. Plain words, a real line to call. Nothing is kept. */
export function CareStill({ care, onBack }: { care: CareView; onBack: () => void }) {
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => head.current?.focus(), []);
  const tel = (n: string) => `tel:${n.replace(/[^\d+]/g, '')}`;
  const [dangerBefore = '', dangerAfter = ''] = L.careDanger.split('{number}');
  return (
    <section className="care-still" aria-labelledby="care-head">
      <h2 id="care-head" ref={head} tabIndex={-1}>
        {L.care1}
      </h2>
      {care.crisis && (
        <p className="care-line">
          <strong>{care.crisis.name}</strong> · {care.crisis.number}
          {care.crisis.hours ? ` · ${care.crisis.hours}` : ''}
          {care.crisis.text ? ` · ${care.crisis.text}` : ''}
        </p>
      )}
      {care.emergency && (
        <p>
          {dangerBefore}
          <strong>{care.emergency}</strong>
          {dangerAfter}
        </p>
      )}
      <p>{L.care2}</p>
      <div className="care-actions">
        {care.crisis && (
          <a className="btn care-call" href={tel(care.crisis.number)}>
            {fillLine(L.careCall, { number: care.crisis.number })}
          </a>
        )}
        <a className={`btn ${care.crisis ? 'care-more' : 'care-call'}`} href={care.more} target="_blank" rel="noopener noreferrer">
          {L.careMore}
        </a>
        <button type="button" className="btn care-back" onClick={onBack}>
          {L.careBack}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------- the wait

/** Android notification ids are 32-bit ints; one stable id per wish. */
function noticeId(wishId: string): number {
  let h = 7;
  for (const ch of `loracle:${wishId}`) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return Math.abs(h) || 1;
}

const roadDone = (w: Wish) => !(ROAD_IN_PROGRESS as readonly string[]).includes(w.road.status) && w.status !== 'moon';
const roadSealed = (w: Wish) => w.road.status === 'ready' || w.road.status === 'drawn';

export interface SealedNotice {
  available: boolean;
  on: boolean;
  toggle: () => void;
}

/**
 * "Tell me when it's sealed", for one wish. In the app: one local notification at now + 150 s
 * (cancelled if the app sees the scroll first). In a browser: a Notification when the poll finds the
 * road ready while the tab is hidden. Permission is asked at the toggle. No push, nothing else, ever.
 */
export function useSealedNotice(wish: Wish | undefined): SealedNotice {
  const id = wish?.id ?? '';
  const key = `lore.loracle.notify.${id}`;
  const available = isNative || (typeof window !== 'undefined' && 'Notification' in window);
  const [on, setOn] = useState(() => {
    try {
      return !!id && localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  // The wish may arrive after the first render: pick up a toggle made before a reload.
  useEffect(() => {
    if (!id) return;
    try {
      setOn(localStorage.getItem(key) === '1');
    } catch {
      // Storage unavailable: the toggle starts off.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const remember = (v: boolean) => {
    try {
      if (v) localStorage.setItem(key, '1');
      else localStorage.removeItem(key);
    } catch {
      // Private mode: it just won't survive a reload.
    }
  };

  const toggle = async () => {
    if (!id) return;
    if (on) {
      setOn(false);
      remember(false);
      if (isNative) await LocalNotifications.cancel({ notifications: [{ id: noticeId(id) }] }).catch(() => undefined);
      return;
    }
    if (isNative) {
      try {
        let { display } = await LocalNotifications.checkPermissions();
        if (display === 'prompt' || display === 'prompt-with-rationale') ({ display } = await LocalNotifications.requestPermissions());
        if (display !== 'granted') return;
        await LocalNotifications.schedule({
          notifications: [
            {
              id: noticeId(id),
              // A phone notification: never the owner's invisible edit marks.
              title: stripMarkers(L.title),
              body: stripMarkers(L.notifyBody),
              schedule: { at: new Date(Date.now() + 150_000), allowWhileIdle: true },
              extra: { href: `/oracle/quest/${id}` },
            },
          ],
        });
      } catch {
        return;
      }
    } else {
      if (!('Notification' in window) || Notification.permission === 'denied') return;
      const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (p !== 'granted') return;
    }
    setOn(true);
    remember(true);
  };

  const done = !!wish && roadDone(wish);
  const sealed = !!wish && roadSealed(wish);
  useEffect(() => {
    if (!on || !wish || !done) return;
    const visible = document.visibilityState === 'visible';
    if (isNative) {
      // Seen in the foreground first: no need to call the Lorer back.
      if (visible || !sealed) {
        void LocalNotifications.cancel({ notifications: [{ id: noticeId(wish.id) }] }).catch(() => undefined);
        setOn(false);
        remember(false);
      }
      return;
    }
    setOn(false);
    remember(false);
    if (sealed && !visible && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(stripMarkers(L.title), { body: stripMarkers(L.notifyBody), tag: `loracle-${wish.id}` });
      } catch {
        // Some mobile browsers only notify from a service worker; the scroll is waiting anyway.
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, done, sealed]);

  return { available, on, toggle: () => void toggle() };
}

const WAIT_SEGMENTS = [
  'M16 96 C 40 70, 64 102, 90 78',
  'M90 78 C 116 54, 138 90, 164 64',
  'M164 64 C 192 38, 216 76, 242 50',
  'M242 50 C 266 26, 288 52, 304 24',
];
const WAIT_GHOST = 'M16 96 C 40 70, 64 102, 90 78 C 116 54, 138 90, 164 64 C 192 38, 216 76, 242 50 C 266 26, 288 52, 304 24';

/** The road drawing itself in four strokes of ink, one per phase of the wait. */
export function WaitInk({ phase, still }: { phase: number; still: boolean }) {
  return (
    <svg viewBox="0 0 320 120" className={`wait-ink${still ? ' still' : ''}`} aria-hidden>
      <path d={WAIT_GHOST} className="wait-ghost" />
      {WAIT_SEGMENTS.map((d, i) => (
        <path key={i} d={d} pathLength={1} className={`wait-seg ${i < phase ? 'done' : i === phase && !still ? 'now' : 'later'}`} />
      ))}
      <circle cx="16" cy="96" r="4" className="wait-start" />
      <path d="M298 18l12 12M310 18l-12 12" className={`wait-x${phase >= WAIT_SEGMENTS.length ? ' shown' : ''}`} />
    </svg>
  );
}

/**
 * The newest of a stream of lines, for a polite live region: at most one announcement every 5 s, so a
 * screen reader is never talked over (the wait's signs, a deeper ask's signs).
 */
export function useSpoken(newest: string): string {
  const [spoken, setSpoken] = useState(newest);
  const lastSpoken = useRef(0);
  useEffect(() => {
    const t = setTimeout(
      () => {
        lastSpoken.current = Date.now();
        setSpoken(newest);
      },
      Math.max(0, lastSpoken.current + 5000 - Date.now()),
    );
    return () => clearTimeout(t);
  }, [newest]);
  return spoken;
}

/**
 * The wait: a parchment slides up under the sunk stone, the road draws itself in ink, the four phases
 * show as words (never a percentage), and the real signs appear beneath (newest three; a polite live
 * region speaks the newest at most every 5 s).
 */
export function InkWait({
  wish,
  notice,
  onRetry,
  retrying,
  retryError,
}: {
  wish: Wish;
  notice: SealedNotice;
  /** Absent for a crew member reading someone's quest: only its Lorer can try again. */
  onRetry?: () => void;
  retrying: boolean;
  retryError: unknown;
}) {
  const road = wish.road;
  const moon = wish.status === 'moon';
  const faded = road.status === 'faded' || wish.status === 'faded';
  const working = !moon && !faded;
  const phase = road.phase ?? (road.status === 'queued' ? 'listening' : null);
  const p = phase ? WAIT_PHASES.indexOf(phase) : roadSealed(wish) ? WAIT_PHASES.length : 0;
  const signs = road.signs.length ? road.signs : [L.listening];
  const shown = signs.slice(-3);
  const newest = signs[signs.length - 1]!;

  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!working) return;
    const t = setTimeout(() => setSlow(true), 120_000);
    return () => clearTimeout(t);
  }, [working]);

  // One announcement per 5 s at most.
  const spoken = useSpoken(newest);

  return (
    <Scroll as="section" className="ink-wait">
      <WaitInk phase={p} still={!working} />
      {moon ? (
        <p className="wait-moon" role="status">
          <Sigil moon /> <span>{L.moon}</span>
        </p>
      ) : faded ? (
        <div className="wait-faded">
          <p className="wait-fog" role="status">
            {onRetry ? L.fogTwice : L.fogTwiceCrew}
          </p>
          {onRetry && (
            <>
              <ErrorNote error={retryError} />
              <button type="button" className={`btn wax-btn${retrying ? ' pending' : ''}`} disabled={retrying} onClick={onRetry}>
                <Sigil />
                <span>{L.tryAgain}</span>
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          <ol className="wait-phases">
            {WAIT_PHASES.map((ph, i) => (
              <li key={ph} className={i < p ? 'done' : i === p ? 'now' : 'later'} aria-current={i === p ? 'step' : undefined}>
                <span className="phase-mark" aria-hidden>
                  {i < p && <Check size={12} strokeWidth={3.5} />}
                </span>
                <span>{WAIT_PHASE_LABELS[ph]}</span>
                {i < p && <span className="sr-only"> (done)</span>}
              </li>
            ))}
          </ol>
          {road.status === 'queued' && road.attempts >= 1 && <p className="wait-fog">{L.fogOnce}</p>}
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
          {slow && <p className="wait-slow">{L.slow}</p>}
          <div className="ink-rule" aria-hidden />
          <p className="wait-walk">{L.walkAway}</p>
          {notice.available && (
            <button type="button" className="ink-tick" aria-pressed={notice.on} onClick={notice.toggle}>
              {L.notifyToggle}
            </button>
          )}
        </>
      )}
    </Scroll>
  );
}

// ---------------------------------------------------------------------------------- the map

export const MAP_W = 340;
export const MAP_H = 236;
const MX = 36;
const MY = 34;
const GAP = 44;

export interface Pin<T extends { where: WaypointWhere } = Waypoint> {
  wp: T;
  i: number;
  x: number;
  y: number;
}

const unwrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * Where each pin sits. With coordinates: their true shape (equirectangular, longitudes narrowed by the
 * mean latitude), fitted into the parchment with margins. Without: a drawn path across the sheet.
 * Pins missing a point sit between their neighbours; then pins are pushed at least 44 apart.
 */
export function layoutPins<T extends { where: WaypointWhere }>(map: T[]): { pins: Pin<T>[]; drawnPath: boolean } {
  const n = map.length;
  const has = map.map((w) => w.where.lat != null && w.where.lon != null);
  const known = has.filter(Boolean).length;
  let pts: { x: number; y: number }[];

  if (!known) {
    pts = map.map((_, i) => {
      const t = n === 1 ? 0.5 : i / (n - 1);
      return { x: MX + t * (MAP_W - 2 * MX), y: MAP_H / 2 + Math.sin(t * Math.PI * 1.7 + 0.6) * MAP_H * 0.26 };
    });
  } else {
    const ref = map[has.indexOf(true)]!.where.lon!;
    const lats = map.filter((_, i) => has[i]).map((w) => w.where.lat!);
    const k = Math.max(0.2, Math.cos(((lats.reduce((a, b) => a + b, 0) / lats.length) * Math.PI) / 180));
    const raw = map.map((w, i) => (has[i] ? { x: unwrap(w.where.lon! - ref) * k, y: -w.where.lat! } : null));
    const xs = raw.filter(Boolean).map((r) => r!.x);
    const ys = raw.filter(Boolean).map((r) => r!.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const s = Math.min(spanX ? (MAP_W - 2 * MX) / spanX : Infinity, spanY ? (MAP_H - 2 * MY) / spanY : Infinity);
    const scale = Number.isFinite(s) ? s : 1;
    const ox = MX + (MAP_W - 2 * MX - spanX * scale) / 2;
    const oy = MY + (MAP_H - 2 * MY - spanY * scale) / 2;
    const placed = raw.map((r) => (r ? { x: ox + (r.x - minX) * scale, y: oy + (r.y - minY) * scale } : null));
    pts = placed.map((pt, i) => {
      if (pt) return pt;
      let a = i - 1;
      while (a >= 0 && !placed[a]) a--;
      let b = i + 1;
      while (b < n && !placed[b]) b++;
      const pa = a >= 0 ? placed[a] : null;
      const pb = b < n ? placed[b] : null;
      if (pa && pb) {
        const t = (i - a) / (b - a);
        return { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t + 14 };
      }
      const from = (pa ?? pb)!;
      const dir = pa ? 1 : -1;
      return { x: from.x + dir * GAP * (pa ? i - a : b - i), y: from.y + 18 };
    });
  }

  const pins = pts.map((pt, i) => ({ wp: map[i]!, i, x: pt.x, y: pt.y }));
  const clamp = (p: Pin<T>) => {
    p.x = Math.min(MAP_W - 22, Math.max(22, p.x));
    p.y = Math.min(MAP_H - 30, Math.max(22, p.y));
  };
  pins.forEach(clamp);
  for (let round = 0; round < 90; round++) {
    let moved = false;
    for (let a = 0; a < pins.length; a++)
      for (let b = a + 1; b < pins.length; b++) {
        const pa = pins[a]!;
        const pb = pins[b]!;
        let dx = pb.x - pa.x;
        let dy = pb.y - pa.y;
        let d = Math.hypot(dx, dy);
        if (d >= GAP) continue;
        if (d < 0.01) {
          // The same spot twice: fan them out.
          const angle = b * 2.39996;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          d = 0;
        } else {
          dx /= d;
          dy /= d;
        }
        const push = (GAP - d) / 2 + 0.5;
        pa.x -= dx * push;
        pa.y -= dy * push;
        pb.x += dx * push;
        pb.y += dy * push;
        clamp(pa);
        clamp(pb);
        moved = true;
      }
    if (!moved) break;
  }
  return { pins, drawnPath: !known };
}

/** One leg of the road: a hand-drawn bend on land, waves at sea. */
export function legPath(a: Pick<Pin, 'x' | 'y' | 'i'>, b: Pick<Pin, 'x' | 'y'>, sea: boolean): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  if (!sea) {
    const bend = (a.i % 2 ? 1 : -1) * Math.min(16, len * 0.16);
    return `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${((a.x + b.x) / 2 + nx * bend).toFixed(1)},${((a.y + b.y) / 2 + ny * bend).toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
  }
  const waves = Math.max(2, Math.round(len / 20));
  let d = `M${a.x.toFixed(1)},${a.y.toFixed(1)}`;
  for (let k = 1; k <= waves; k++) {
    const t0 = (k - 0.5) / waves;
    const t1 = k / waves;
    const amp = k % 2 ? 5 : -5;
    d += ` Q${(a.x + dx * t0 + nx * amp).toFixed(1)},${(a.y + dy * t0 + ny * amp).toFixed(1)} ${(a.x + dx * t1).toFixed(1)},${(a.y + dy * t1).toFixed(1)}`;
  }
  return d;
}

export const shortName = (name: string) => (name.length > 22 ? `${name.slice(0, 21).trimEnd()}…` : name);

/**
 * The true-shape ink map: no tiles, no third-party map requests. The SVG is decoration for sighted
 * readers (aria-hidden); the ordered list under it is the same map in words.
 */
export function TrueMap({ road, nextSealed, onOpen }: { road: WishScroll; nextSealed: string | null; onOpen: (id: string) => void }) {
  const waxId = useId();
  const { pins, drawnPath } = layoutPins(road.map);
  const drawing = road.status === 'ready';
  return (
    <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className={`true-map${drawnPath ? ' drawn-path' : ''}`} aria-hidden>
      <defs>
        <radialGradient id={waxId} cx="35%" cy="30%">
          <stop offset="0" stopColor="#c43a2c" />
          <stop offset="0.55" stopColor="#9b2418" />
          <stop offset="1" stopColor="#6b120b" />
        </radialGradient>
      </defs>
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
        return <path key={b.wp.id} d={legPath(a, b, sea)} className={`map-road${sea ? ' sea' : ''}${b.wp.state === 'inked' ? ' inked' : ''}`} />;
      })}
      {pins.map((p) => {
        const Icon = emblemIcon(p.wp.emblem);
        const ring = p.wp.where.precision === 'town' || p.wp.where.precision === 'country';
        const unplaced = drawing && (p.wp.where.lat == null || p.wp.where.lon == null);
        const sealed = p.wp.state === 'sealed';
        return (
          <g
            key={p.wp.id}
            className={`map-pin ${p.wp.state}${p.wp.id === nextSealed ? ' next' : ''}${unplaced ? ' unplaced' : ''}`}
            transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
            onClick={() => onOpen(p.wp.id)}
          >
            {p.wp.id === nextSealed && <circle r="21" className="map-glow" />}
            {ring && !unplaced && <circle r="19.5" className="map-ring" />}
            <circle r="14.5" className={sealed ? 'map-wax' : 'map-medal'} fill={sealed ? `url(#${waxId})` : undefined} />
            {unplaced ? (
              <text y="5" className="map-q">
                ?
              </text>
            ) : (
              <Icon x={-8} y={-8} size={16} strokeWidth={2.2} className="map-icon" />
            )}
            {p.wp.state === 'inked' && <path d="M6 -16 l3.5 3.5 7 -8" className="map-check" />}
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

const civil = (date: string) => new Date(`${date.length === 7 ? `${date}-01` : date}T12:00:00`);
export const fmtDay = (date: string) => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' }).format(civil(date));
export const inkedLine = (on: string | null) => (on ? fillLine(MORE.inkedOn, { date: fmtDay(on) }) : MORE.inked);

/** The map in words: the accessible twin, and where a waypoint's sheet opens. `extra` adds to a row (who walks it). */
export function WaypointList({
  road,
  nextSealed,
  onOpen,
  extra,
}: {
  road: WishScroll;
  nextSealed: string | null;
  onOpen: (id: string) => void;
  extra?: (wp: Waypoint) => ReactNode;
}) {
  return (
    <ol className="waypoint-list">
      {road.map.map((wp, i) => (
        <li key={wp.id}>
          <button type="button" className={`waypoint-row ${wp.state}${wp.id === nextSealed ? ' next' : ''}`} data-wp={wp.id} onClick={() => onOpen(wp.id)}>
            <WaxSeal emblem={wp.emblem} tone={wp.state === 'sealed' ? 'wax' : wp.state === 'inked' ? 'inked' : 'open'} className={wp.id === nextSealed ? 'next' : ''} />
            <span className="wp-text">
              <span className="wp-name">
                <span className="wp-n">{i + 1}.</span> {wp.name}
              </span>
              <span className="wp-when">{wp.when}</span>
              <span className="wp-clue">{wp.clue}</span>
              {wp.state === 'sealed' ? (
                <span className="wp-state sealed">
                  <Lock size={12} aria-hidden /> {L.sealed}
                </span>
              ) : wp.state === 'inked' ? (
                <span className="wp-state inked">
                  <Check size={12} aria-hidden strokeWidth={3} /> {inkedLine(wp.inkedOn)}
                </span>
              ) : null}
              {extra?.(wp)}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------------- waypoint sheets

/** "Pantheon, Rome, Italy": the place, its town and its land, without repeats. */
export function whereLine(w: WaypointWhere): string {
  const parts: string[] = [];
  for (const part of [w.place, w.town, countryName(w.country)]) {
    if (part && !parts.some((p) => p.toLowerCase() === part.toLowerCase())) parts.push(part);
  }
  return parts.join(', ');
}

const MAP_ZOOM: Record<string, number> = { ledger: 15, place: 15, town: 11, country: 5, sea: 5 };

/** "Open in maps": geo: on Android, Apple Maps on iOS, OpenStreetMap on the web. */
function mapsHref(w: WaypointWhere, name: string): string {
  const platform = Capacitor.getPlatform();
  const point = w.lat != null && w.lon != null;
  const q = encodeURIComponent(whereLine(w));
  if (platform === 'android') return point ? `geo:${w.lat},${w.lon}?q=${w.lat},${w.lon}(${encodeURIComponent(name)})` : `geo:0,0?q=${q}`;
  if (platform === 'ios') return point ? `https://maps.apple.com/?ll=${w.lat},${w.lon}&q=${encodeURIComponent(name)}` : `https://maps.apple.com/?q=${q}`;
  const z = MAP_ZOOM[w.precision ?? 'place'] ?? 12;
  return point ? `https://www.openstreetmap.org/?mlat=${w.lat}&mlon=${w.lon}#map=${z}/${w.lat}/${w.lon}` : `https://www.openstreetmap.org/search?query=${q}`;
}

function SheetTitle({ wp, index }: { wp: Waypoint; index: number }) {
  return (
    <span className="sheet-title">
      <WaxSeal emblem={wp.emblem} tone={wp.state === 'sealed' ? 'wax' : wp.state === 'inked' ? 'inked' : 'open'} />
      <span>
        <span className="sheet-kicker">{fillLine(MORE.waypoint, { n: index + 1 })}</span>
        <span className="sheet-name">{wp.name}</span>
      </span>
    </span>
  );
}

function Mystery({ text }: { text: string }) {
  return (
    <section className="sheet-block sheet-mystery">
      <h3 className="sheet-h">{L.mystery}</h3>
      <p>
        <em>{text}</em>
      </p>
    </section>
  );
}

/**
 * A waypoint's sheet: sealed, only its name, clue and mystery under wax; open, everything and the deeds.
 * `readOnly` (a crew member reading someone's quest): no seal to break, no deeds. `extra` comes last
 * (Ask the stone, its pinned scrolls, who walks it).
 */
export function WaypointSheet({
  wp,
  index,
  onClose,
  readOnly = false,
  extra,
}: {
  wp: Waypoint;
  index: number;
  onClose: () => void;
  readOnly?: boolean;
  extra?: ReactNode;
}) {
  const unseal = useAction(() => api.post<unknown>(`/loracle/waypoints/${wp.id}/unseal`));

  if (wp.state === 'sealed') {
    return (
      <ScrollSheet label={wp.name} title={<SheetTitle wp={wp} index={index} />} onClose={onClose}>
        <p className="sheet-clue">{wp.clue}</p>
        {wp.mystery && <Mystery text={wp.mystery} />}
        <p className="sealed-note">
          <Lock size={14} aria-hidden /> {L.sealed}
        </p>
        {!readOnly && (
          <>
            <ErrorNote error={unseal.error} />
            <div className="sheet-actions">
              <button type="button" className={`btn wax-btn${unseal.isPending ? ' pending' : ''}`} disabled={unseal.isPending} onClick={() => unseal.mutate(undefined)}>
                <Sigil />
                <span>{L.breakSeal}</span>
              </button>
            </div>
          </>
        )}
        {extra}
      </ScrollSheet>
    );
  }

  return (
    <ScrollSheet label={wp.name} title={<SheetTitle wp={wp} index={index} />} onClose={onClose}>
      <dl className="sheet-facts">
        <div>
          <dt>{L.when}</dt>
          <dd>{wp.when}</dd>
        </div>
        <div>
          <dt>{L.where}</dt>
          <dd>
            {whereLine(wp.where)}{' '}
            <a className="sheet-maps" href={mapsHref(wp.where, wp.name)} target="_blank" rel="noopener noreferrer">
              <MapPin size={14} aria-hidden /> {L.openInMaps}
            </a>
          </dd>
        </div>
      </dl>
      <p className="sheet-clue">
        {wp.clue}
        {wp.lore && <span className="lore-tag"> ({MORE.legend})</span>}
      </p>
      <section className="sheet-block">
        <h3 className="sheet-h">{L.trial}</h3>
        <p>{wp.trial}</p>
      </section>
      {wp.person && (
        <section className="sheet-block">
          <h3 className="sheet-h">{L.keeper}</h3>
          <p>
            <strong>{wp.person.name ?? wp.person.role}</strong>
            {wp.person.name ? `, ${wp.person.role}` : ''} <MarkDot mark={wp.person.mark} />
          </p>
          <p className="sheet-ask">{fillLine(MORE.askOf, { verb: wp.person.verb })}</p>
        </section>
      )}
      {wp.earns && (
        <section className="sheet-block">
          <h3 className="sheet-h">{L.earns}</h3>
          <p>{wp.earns}</p>
        </section>
      )}
      {wp.mystery && <Mystery text={wp.mystery} />}
      {wp.steps.length > 0 && (
        <section className="sheet-block">
          <h3 className="sheet-h">{L.realRoad}</h3>
          <ol className="road-steps">
            {wp.steps.map((s, i) => (
              <li key={i}>
                <span className={`step-kind ${s.kind}`}>{STEP_KIND_LABELS[s.kind]}</span>
                <span className="step-text">
                  {s.text} <MarkDot mark={s.mark} />
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {!readOnly && <WaypointDeeds wp={wp} />}
      {extra}
    </ScrollSheet>
  );
}

/**
 * "Write the chapter": a private chapter is started from the waypoint in the Lorebook, tied to it, and
 * opened so the Lorer can tell the story and add the photos.
 */
export function useWriteChapter(wp: Pick<OpenWaypoint, 'id' | 'name' | 'inkedOn' | 'where' | 'note'>) {
  const navigate = useNavigate();
  return useAction(
    async () => {
      const c = await api.post<ChapterDetail>('/chapters', {
        title: wp.name.slice(0, 120),
        occurredOn: wp.inkedOn ?? todayISO(),
        locationName: whereLine(wp.where).slice(0, 200) || null,
        summary: wp.note,
        audience: 'only_me',
      });
      await api.put<unknown>(`/loracle/waypoints/${wp.id}/link`, { chapterId: c.id });
      return c;
    },
    { onSuccess: (c) => navigate(`/chapters/${c.id}`) },
  );
}

/** Make it a plan · Keep in the vault · I did this → Write the chapter. Each links back to the waypoint. */
function WaypointDeeds({ wp }: { wp: OpenWaypoint }) {
  const [inking, setInking] = useState(false);
  const [on, setOn] = useState(todayISO());
  const [note, setNote] = useState('');
  const plan = useAction(() => api.post<unknown>(`/loracle/waypoints/${wp.id}/plan`, {}));
  const vault = useAction(() => api.post<unknown>(`/loracle/waypoints/${wp.id}/vault`, {}));
  const ink = useAction(() => api.post<unknown>(`/loracle/waypoints/${wp.id}/ink`, { on, note: note.trim() || null }), {
    onSuccess: () => setInking(false),
  });
  const unink = useAction(() => api.del<unknown>(`/loracle/waypoints/${wp.id}/ink`));
  const chapter = useWriteChapter(wp);
  const busy = plan.isPending || vault.isPending || ink.isPending || unink.isPending || chapter.isPending;
  const inkId = useId();

  return (
    <section className="sheet-block sheet-deeds">
      {wp.state === 'inked' && (
        <div className="inked-line">
          <p>
            <Check size={15} strokeWidth={3} aria-hidden /> {inkedLine(wp.inkedOn)}
          </p>
          {wp.note && <p className="inked-note">{wp.note}</p>}
        </div>
      )}
      <ErrorNote error={plan.error ?? vault.error ?? ink.error ?? unink.error ?? chapter.error} />
      <div className="sheet-actions">
        {wp.state === 'inked' &&
          (wp.links.chapterId ? (
            <Link to={`/chapters/${wp.links.chapterId}`} className="btn wax-btn">
              {MORE.readChapter}
            </Link>
          ) : (
            <button type="button" className={`btn wax-btn${chapter.isPending ? ' pending' : ''}`} disabled={busy} onClick={() => chapter.mutate(undefined)}>
              <Feather size={18} aria-hidden />
              <span>{L.writeChapter}</span>
            </button>
          ))}
        {wp.state === 'open' &&
          (inking ? (
            <form
              className="ink-form"
              onSubmit={(e) => {
                e.preventDefault();
                ink.mutate(undefined);
              }}
            >
              <label htmlFor={`${inkId}-on`}>{MORE.inkDay}</label>
              <input id={`${inkId}-on`} type="date" className="parch-input" value={on} max={todayISO()} onChange={(e) => setOn(e.target.value)} required />
              <label htmlFor={`${inkId}-note`}>{L.inkNote}</label>
              <textarea id={`${inkId}-note`} className="parch-input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
              <button className={`btn wax-btn${ink.isPending ? ' pending' : ''}`} disabled={busy}>
                <Check size={18} strokeWidth={3} aria-hidden />
                <span>{L.ink}</span>
              </button>
            </form>
          ) : (
            <button type="button" className="btn wax-btn" disabled={busy} onClick={() => setInking(true)}>
              <Check size={18} strokeWidth={3} aria-hidden />
              <span>{L.ink}</span>
            </button>
          ))}
        {wp.links.eventId ? (
          <Link to={`/events/${wp.links.eventId}`} className="btn parch-btn">
            {MORE.openPlan}
          </Link>
        ) : (
          <button type="button" className="btn parch-btn" disabled={busy} onClick={() => plan.mutate(undefined)}>
            {L.plan}
          </button>
        )}
        {wp.links.ideaId ? (
          <Link to={`/ideas/${wp.links.ideaId}`} className="btn parch-btn">
            {MORE.inVault}
          </Link>
        ) : (
          <button type="button" className="btn parch-btn" disabled={busy} onClick={() => vault.mutate(undefined)}>
            {L.vault}
          </button>
        )}
        {wp.state === 'inked' && (
          <button type="button" className="btn ink-link" disabled={busy} onClick={() => unink.mutate(undefined)}>
            {L.unink}
          </button>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------- the scroll

export function spanLine(span: QuestSpan): string {
  const unit = span.amount === 1 ? span.unit.replace(/s$/, '') : span.unit;
  return fillLine(L.span, { amount: span.amount, unit });
}

/** Coin, Papers, Body, Skills, Tongue. Empty groups are hidden; the one rule sits first under Body, in wax. */
export function ProvisionsTable({ road }: { road: WishScroll }) {
  const p = road.provisions;
  const groups = PROVISION_GROUPS.filter((g) => (p?.[g].length ?? 0) > 0 || (g === 'body' && road.rule));
  if (!groups.length) return null;
  return (
    <section className="quest-section quest-provisions" aria-labelledby="q-provisions">
      <h3 id="q-provisions" className="scroll-kicker">
        {L.provisions}
      </h3>
      {groups.map((g) => (
        <div key={g} className="provision-group">
          <h4>{PROVISION_LABELS[g]}</h4>
          {g === 'body' && road.rule && (
            <p className="quest-rule">
              <span className="quest-rule-label">{L.rule}</span> {road.rule}
            </p>
          )}
          {(p?.[g].length ?? 0) > 0 && (
            <ul>
              {p![g].map((line, i) => (
                <li key={i} className={line.counsel ? 'counsel' : undefined}>
                  {line.text} <MarkDot mark={line.mark} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}

/**
 * This week: one deed under an hour, and "Put it in my week" (a reminder at 18:00 on the day, unless changed).
 * `readOnly` (a crew member reading it): the deed only; the reminder is the Lorer's own.
 */
export function ThisWeekStrip({ road, readOnly = false }: { road: WishScroll; readOnly?: boolean }) {
  const tw = road.thisWeek;
  const [setting, setSetting] = useState(false);
  const [day, setDay] = useState(() => (tw?.day && tw.day >= todayISO() ? tw.day : todayISO()));
  const [time, setTime] = useState('18:00');
  const id = useId();
  const put = useAction(
    async () => {
      await ensureReminderPermission();
      return api.post<unknown>(`/loracle/roads/${road.id}/week`, { day, time });
    },
    { onSuccess: () => setSetting(false) },
  );
  if (!tw) return null;
  return (
    <section className="quest-section" aria-labelledby="q-week">
      <h3 id="q-week" className="scroll-kicker">
        {L.thisWeek}
      </h3>
      <div className="this-week">
        <p className="this-week-deed">
          {tw.text} <MarkDot mark={tw.mark} />
        </p>
        <p className="this-week-minutes">{fillLine(MORE.minutes, { minutes: tw.minutes })}</p>
        {readOnly ? null : tw.reminderId ? (
          <p className="this-week-set">
            <Check size={15} strokeWidth={3} aria-hidden /> {MORE.inWeek} <Link to="/notes">{MORE.seeNotes}</Link>
          </p>
        ) : setting ? (
          <form
            className="week-form"
            onSubmit={(e) => {
              e.preventDefault();
              put.mutate(undefined);
            }}
          >
            <label htmlFor={`${id}-d`}>
              {MORE.day}
              <input id={`${id}-d`} type="date" className="parch-input" value={day} min={todayISO()} onChange={(e) => setDay(e.target.value)} required />
            </label>
            <label htmlFor={`${id}-t`}>
              {MORE.time}
              <input id={`${id}-t`} type="time" className="parch-input" value={time} onChange={(e) => setTime(e.target.value)} required />
            </label>
            <ErrorNote error={put.error} />
            <button className={`btn wax-btn${put.isPending ? ' pending' : ''}`} disabled={put.isPending}>
              {MORE.setIt}
            </button>
          </form>
        ) : (
          <button type="button" className="btn wax-btn" onClick={() => setSetting(true)}>
            {L.putInWeek}
          </button>
        )}
      </div>
    </section>
  );
}

/** Left in the fog: what only the road can tell, each leading to its waypoint. */
export function FogList({ road, onOpen }: { road: WishScroll; onOpen: (id: string) => void }) {
  const lines = road.fog.filter((f) => road.map.some((w) => w.position === f.position));
  if (!lines.length) return null;
  return (
    <section className="quest-section" aria-labelledby="q-fog">
      <h3 id="q-fog" className="scroll-kicker">
        {L.fog}
      </h3>
      <ul className="fog-list">
        {lines.map((f, i) => {
          const wp = road.map.find((w) => w.position === f.position)!;
          return (
            <li key={i}>
              <button type="button" onClick={() => onOpen(wp.id)}>
                <em>{f.text}</em> <span className="fog-at">{wp.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Where the stone looked: folded; numbered, with the host, the date and whether it was opened. (Also a deeper ask's own.) */
export function SourcesFold({ road }: { road: Pick<WishScroll, 'sources'> }) {
  if (!road.sources.length) return null;
  return (
    <details className="quest-sources">
      <summary>{L.looked}</summary>
      <ol>
        {road.sources.map((s) => (
          <li key={s.n} id={`src-${s.n}`} value={s.n}>
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              {s.title || s.host}
            </a>
            <span className="source-meta">
              {' '}
              · {s.host}
              {s.date ? ` · ${s.date}` : ''} · {s.opened ? L.opened : L.seenInSearch}
            </span>
          </li>
        ))}
      </ol>
      <p className="quest-check">{L.checkBefore}</p>
    </details>
  );
}

/** Burning is final: one tap asks, the second burns. */
export function BurnScroll({ wishId }: { wishId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);
  const burn = useMutation<unknown, ApiError>({
    mutationFn: () => api.del<unknown>(`/loracle/wishes/${wishId}`),
    onSuccess: () => {
      navigate('/oracle', { replace: true });
      qc.removeQueries({ queryKey: ['wish', wishId] });
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' && q.queryKey[0] !== 'wish' });
    },
  });
  return asking ? (
    <div className="burn-ask" role="group" aria-label={L.burnConfirm}>
      <p>{L.burnConfirm}</p>
      <ErrorNote error={burn.error} />
      <div className="row">
        <button type="button" className={`btn burn-btn${burn.isPending ? ' pending' : ''}`} disabled={burn.isPending} onClick={() => burn.mutate()}>
          <Flame size={17} aria-hidden /> {MORE.burnIt}
        </button>
        <button type="button" className="btn ink-link" onClick={() => setAsking(false)} ref={keepRef}>
          {MORE.keepIt}
        </button>
      </div>
    </div>
  ) : (
    <button type="button" className="btn ink-link burn-link" onClick={() => setAsking(true)}>
      {L.burn}
    </button>
  );
}

/** The quest's end: it came true (lore), let it go, take it up again, or burn it. */
function QuestDeeds({ wish }: { wish: Wish }) {
  const patch = useAction((status: 'fulfilled' | 'released' | 'revealed') => api.patch<unknown>(`/loracle/wishes/${wish.id}`, { status }));
  return (
    <section className="quest-section quest-deeds">
      {wish.status === 'fulfilled' && <p className="quest-state lore">{MORE.fulfilledLine}</p>}
      {wish.status === 'released' && <p className="quest-state">{MORE.letGoLine}</p>}
      <ErrorNote error={patch.error} />
      <div className="sheet-actions">
        {wish.status === 'revealed' && (
          <>
            <button type="button" className="btn gold-btn" disabled={patch.isPending} onClick={() => patch.mutate('fulfilled')}>
              <Crown size={18} aria-hidden />
              <span>{L.fulfilled}</span>
            </button>
            <button type="button" className="btn parch-btn" disabled={patch.isPending} onClick={() => patch.mutate('released')}>
              {L.release}
            </button>
          </>
        )}
        {(wish.status === 'fulfilled' || wish.status === 'released') && (
          <button type="button" className="btn parch-btn" disabled={patch.isPending} onClick={() => patch.mutate('revealed')}>
            {L.takeUp}
          </button>
        )}
      </div>
      <BurnScroll wishId={wish.id} />
    </section>
  );
}

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The scroll: the quest's name carved, the Calling set large, the true-shape map and its waypoints
 * (two open, the rest under wax), Provisions, This week, Left in the fog, Where the stone looked.
 */
export function ScrollView({
  wish,
  existing = false,
  readOnly = false,
  only,
  after,
  sheetExtra,
  rowExtra,
}: {
  wish: Wish;
  existing?: boolean;
  /** A crew member reading someone's quest: no deeds, no seals to break, no reminder. */
  readOnly?: boolean;
  /** Replaces the words of "Only you can see this scroll." (a quest shown to a crew). */
  only?: ReactNode;
  /** After that line, inside the scroll (Show to a crew, Report). */
  after?: ReactNode;
  /** Added at the end of a waypoint's sheet (Ask the stone, who walks it). */
  sheetExtra?: (wp: Waypoint) => ReactNode;
  /** Added to a waypoint's row in the list (who walks it). */
  rowExtra?: (wp: Waypoint) => ReactNode;
}) {
  const road = wish.road;
  const [openId, setOpenId] = useState<string | null>(null);
  const openIndex = road.map.findIndex((w) => w.id === openId);
  const open = openIndex >= 0 ? road.map[openIndex]! : null;
  const nextSealed = road.map.find((w) => w.state === 'sealed')?.id ?? null;
  const listRef = useRef<HTMLDivElement>(null);

  // Revisiting: bring the first un-inked waypoint into view.
  useEffect(() => {
    if (!wish.inked) return;
    const first = road.map.find((w) => w.state !== 'inked');
    if (!first) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-wp="${first.id}"]`)
      ?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wish.id]);

  return (
    <>
      <Scroll as="article" className={`quest-scroll ${wish.status}`}>
        {existing && <p className="quest-dup">{L.duplicate}</p>}
        <h2 className="quest-title">{road.title}</h2>
        {road.span && <p className="quest-span no-drop">{spanLine(road.span)}</p>}
        <div className="ink-rule" aria-hidden />

        <section className="quest-section" aria-labelledby="q-calling">
          <h3 id="q-calling" className="scroll-kicker">
            {L.calling}
          </h3>
          {wish.beyond && <p className="quest-beyond">{L.beyond}</p>}
          <p className="quest-calling-text">{road.calling}</p>
          {road.truth && <p className="quest-truth">{road.truth}</p>}
        </section>

        {road.map.length > 0 && (
          <section className="quest-section" aria-labelledby="q-map">
            <h3 id="q-map" className="scroll-kicker">
              {L.map}
            </h3>
            <TrueMap road={road} nextSealed={nextSealed} onOpen={setOpenId} />
            <div ref={listRef}>
              <WaypointList road={road} nextSealed={nextSealed} onOpen={setOpenId} extra={rowExtra} />
            </div>
          </section>
        )}

        <ProvisionsTable road={road} />
        <ThisWeekStrip road={road} readOnly={readOnly} />
        <FogList road={road} onOpen={setOpenId} />
        <SourcesFold road={road} />
        {!readOnly && <QuestDeeds wish={wish} />}
        <p className="quest-only">
          {only ?? (
            <>
              <Lock size={14} aria-hidden /> {L.onlyYou}
            </>
          )}
        </p>
        {after}
      </Scroll>
      {open && (
        <WaypointSheet key={open.id} wp={open} index={openIndex} onClose={() => setOpenId(null)} readOnly={readOnly} extra={sheetExtra?.(open)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------- the quest log

/** A wish written down for the dawn lane (phase B), not yet read. */
export const atDawn = (w: WishSummary) => w.status === 'listening' && w.lane === 'dawn';

export function questLine(w: WishSummary): string {
  if (atDawn(w)) return L.logDawn;
  switch (w.status) {
    case 'listening':
      return MORE.logListening;
    case 'moon':
      return MORE.logMoon;
    case 'faded':
      return MORE.logFaded;
    case 'silent':
      return MORE.logSilent;
    case 'fulfilled':
      return L.lore;
    default:
      return w.total ? fillLine(L.inked, { inked: w.inked, total: w.total }) : MORE.logListening;
  }
}

/** A rolled scroll in the log. `sub` replaces its second line (a quest shown to you: whose, and in which crew). */
export function QuestRoll({ w, sub }: { w: WishSummary; sub?: string }) {
  const tone: SealTone = w.status === 'fulfilled' ? 'gold' : w.status === 'released' ? 'stone' : 'wax';
  const moon = w.status === 'moon' || atDawn(w);
  return (
    <Link to={`/oracle/quest/${w.id}`} className={`quest-roll ${w.status}`}>
      <WaxSeal emblem={w.seal} tone={tone} />
      <span className="roll-text">
        <span className="roll-title">{w.title ?? w.text}</span>
        <span className="roll-sub">{sub ?? questLine(w)}</span>
      </span>
      {moon && <Moon size={16} aria-hidden className="roll-moon" />}
    </Link>
  );
}

/** Your quests: rolled scrolls, newest first, at most 30, and the let-go folded below (at most 10). */
export function QuestLog({ wishes, letGo }: { wishes: WishSummary[]; letGo: WishSummary[] }) {
  return (
    <>
      {wishes.length ? (
        <ol className="quest-log">
          {wishes.map((w) => (
            <li key={w.id}>
              <QuestRoll w={w} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="quest-log-empty">{L.noQuests}</p>
      )}
      {letGo.length > 0 && (
        <details className="quest-letgo">
          <summary>{L.letGo}</summary>
          <ol className="quest-log">
            {letGo.map((w) => (
              <li key={w.id}>
                <QuestRoll w={w} />
              </li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}

/** Kept here so the page can tell what to show: is this wish's road still being drawn? */
export const isDrawn = (w: Wish) => roadSealed(w) && !!w.road.title;
export const isSilent = (w: Wish) => w.status === 'silent' || w.road.status === 'silent';
