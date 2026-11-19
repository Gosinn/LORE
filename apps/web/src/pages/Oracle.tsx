// The Loracle (/oracle): wishes first, wishes only. The Lorer tells the stones what they want; the
// stones answer with a road (a quest), drawn by the stone's mind on the server. The old tourist
// Futures (readings) are gone from the app; their routes and data stay on the server for exports.
import { Crown, Lock, Moon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  LORACLE_LINES,
  fillLine,
  type CareView,
  type CastResult,
  type LoracleContext,
  type LoracleState,
  type Wish,
} from '#shared';
import {
  AsleepStone,
  BurnScroll,
  CareStill,
  ConsentSheet,
  InkWait,
  MORE,
  QuestLog,
  RerouteOffer,
  RiddleStones,
  ScrollView,
  StoneHeader,
  WishWell,
  isDrawn,
  isSilent,
  useSealedNotice,
} from '../components/loracle.tsx';
import {
  AskAgain,
  CrewCanSee,
  CrewQuestLog,
  DawnWait,
  EpicScroll,
  RoadTabs,
  ShareLine,
  ViewerLine,
  WalkerMarks,
  WaypointExtra,
} from '../components/loracle-b.tsx';
import { Embers, ReminderScroll, RuneRow, StoneCircle } from '../components/oracle.tsx';
import { PageError, Section, TopBar } from '../components/ui.tsx';
import { api, type ApiError } from '../lib/api.ts';
import { localTimeZone } from '../lib/dates.ts';
import { isMine, pickRoad, roadAtDawn, roadInProgress, roadsOf, sharedCrew, walkersOf } from '../lib/loracle.ts';
import { useAction, useEpic, useLoracle, useWish } from '../lib/queries.ts';
import '../styles/loracle-b.css';

const L = LORACLE_LINES;

type Screen =
  | { kind: 'speak' }
  | { kind: 'riddle'; question: string; options: string[] }
  | { kind: 'reroute'; offer: string; offerToken: string }
  | { kind: 'care'; care: CareView };

interface CastBody {
  text: string;
  riddleAnswer?: string;
  rerouted?: boolean;
  offerToken?: string;
}

/** Error codes the page answers in the stone's own words (anything else shows its message). */
const ANSWERED = new Set(['consent', 'asleep', 'realm', 'fog']);

function Waking() {
  return (
    <div className="oracle-page">
      <TopBar back title={L.title} />
      <div className="oracle-waking" role="status">
        <div className="stone-window" aria-hidden>
          <StoneCircle active />
          <Embers active />
        </div>
        <p>The stones are waking…</p>
      </div>
    </div>
  );
}

export function OraclePage() {
  const loracle = useLoracle();
  if (loracle.isLoading) return <Waking />;
  if (loracle.error || !loracle.data)
    return (
      <div className="oracle-page">
        <PageError error={loracle.error} />
      </div>
    );
  return <StoneFace state={loracle.data} />;
}

function StoneFace({ state }: { state: LoracleState }) {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const carried = (location.state as { text?: string } | null)?.text;
  const [text, setText] = useState(carried ?? L.wishStart);
  const [ctx, setCtx] = useState<LoracleContext>(state.settings.context);
  const [screen, setScreen] = useState<Screen>({ kind: 'speak' });
  const [line, setLine] = useState<string | null>(null);
  const [consentFor, setConsentFor] = useState<CastBody | null>(null);
  const [withdrawn, setWithdrawn] = useState(false);
  // Phase C: quests other Lorers showed to my crews (absent from a phase A server mid-deploy).
  const crewQuests = state.crewQuests ?? [];

  const cast = useAction((b: CastBody) => api.post<CastResult>('/loracle/wishes', { ...b, context: ctx, timeZone: localTimeZone() }), {
    set: (r) => (r.route === 'quest' ? [['wish', r.wish.id], r.wish] : null),
    onSuccess: (r, b) => {
      switch (r.route) {
        case 'quest':
          navigate(`/oracle/quest/${r.wish.id}`, { state: { existing: r.existing } });
          return;
        case 'riddle':
          setScreen({ kind: 'riddle', question: r.riddle.question, options: r.riddle.options });
          return;
        case 'reroute':
          setScreen({ kind: 'reroute', offer: r.offer, offerToken: r.offerToken });
          return;
        case 'care':
          setScreen({ kind: 'care', care: r.care });
          return;
        case 'silent':
          setText(b.text);
          setScreen({ kind: 'speak' });
          setLine(L.silent);
          return;
        case 'rest':
          setScreen({ kind: 'speak' });
          setLine(L.rest);
          return;
        case 'moon':
          setScreen({ kind: 'speak' });
          setLine(L.moonFull);
          return;
      }
    },
  });

  const castNow = (b: CastBody) =>
    cast.mutate(b, {
      onError: (e: ApiError) => {
        if (e.code === 'consent') setConsentFor(b);
        else if (e.code === 'asleep') void qc.invalidateQueries({ queryKey: ['loracle'] });
        else if (e.code === 'realm') {
          setScreen({ kind: 'speak' });
          setLine(MORE.realmNoCountry);
        } else if (e.code === 'fog') setLine(L.fogWeigh);
      },
    });
  const send = (b: CastBody) => {
    setLine(null);
    setWithdrawn(false);
    if (!state.consented) setConsentFor(b);
    else castNow(b);
  };

  const consent = useAction(() => api.post<unknown>('/loracle/consent'), {
    onSuccess: () => {
      const b = consentFor;
      setConsentFor(null);
      if (b) castNow(b);
    },
  });
  const withdraw = useAction(() => api.del<unknown>('/loracle/consent'), { onSuccess: () => setWithdrawn(true) });

  const backToSpeak = (clear = false) => {
    if (clear) setText(L.wishStart);
    setLine(null);
    cast.reset();
    setScreen({ kind: 'speak' });
  };

  const asleep = state.mind === 'asleep';
  const casting = cast.isPending;
  const still = screen.kind === 'care';
  const castError = cast.error && !ANSWERED.has(cast.error.code) ? cast.error : null;

  return (
    <div className="oracle-page">
      <TopBar back title={L.title} />
      <StoneHeader speaking={casting} still={still} asleep={asleep} />
      {state.mind === 'fake' && (
        <p className="dreaming" role="note">
          <Moon size={15} aria-hidden /> {L.dreaming}
        </p>
      )}
      {asleep ? (
        <AsleepStone />
      ) : screen.kind === 'care' ? (
        <CareStill care={screen.care} onBack={() => backToSpeak(true)} />
      ) : screen.kind === 'riddle' ? (
        <RiddleStones
          riddle={screen}
          pending={casting}
          error={castError}
          onAnswer={(answer) => send({ text, riddleAnswer: answer })}
          onBack={() => backToSpeak()}
        />
      ) : screen.kind === 'reroute' ? (
        <RerouteOffer
          offer={screen.offer}
          pending={casting}
          error={castError}
          onCast={() => {
            setText(screen.offer);
            send({ text: screen.offer, rerouted: true, offerToken: screen.offerToken });
          }}
          onLet={() => backToSpeak()}
        />
      ) : (
        <WishWell
          settings={state.settings}
          text={text}
          setText={setText}
          ctx={ctx}
          setCtx={setCtx}
          pending={casting}
          line={line ?? (withdrawn ? MORE.consentWithdrawn : null)}
          error={castError}
          onCast={() => send({ text: text.trim() })}
        />
      )}

      {!still && <ReminderScroll />}

      {!still && (
        <Section title={L.quests}>
          <QuestLog wishes={state.wishes} letGo={state.letGo} />
        </Section>
      )}

      {!still && crewQuests.length > 0 && (
        <Section title={L.crewQuests}>
          <CrewQuestLog quests={crewQuests} />
        </Section>
      )}

      {!still && (
        <p className="oracle-oath">
          <Lock size={16} aria-hidden /> {MORE.onlyYouAll} {L.shownToo}
        </p>
      )}
      {state.consented && !asleep && !still && (
        <button type="button" className="btn ghost-carve oracle-withdraw" disabled={withdraw.isPending} onClick={() => withdraw.mutate(undefined)}>
          {L.consentWithdraw}
        </button>
      )}
      {!still && (
        <p className="oracle-colophon">
          The stone’s mind is Claude, by Anthropic. It looks at the public web and can be wrong or out of date: check every step
          with the people and places themselves before you go. Town search by OpenStreetMap (© OpenStreetMap contributors).
        </p>
      )}

      {consentFor && (
        <ConsentSheet pending={consent.isPending || casting} error={consent.error} onYes={() => consent.mutate(undefined)} onNo={() => setConsentFor(null)} />
      )}
    </div>
  );
}

/**
 * The wish carved into the small stone at the top of a quest (and of its epic). `label` names whose wish
 * it is for a screen reader ("Your wish", or "Sunna’s wish" for a crew member).
 */
function QuestStone({ text, working, label = L.wishLabel }: { text: string; working: boolean; label?: string }) {
  return (
    <section className={`oracle-stone compact${working ? ' speaking sunk' : ''}`}>
      <div className="stone-window" aria-hidden>
        <StoneCircle active={working} />
        <Embers active={working} />
      </div>
      <p className="wish-carved">
        <span className="sr-only">{label}: </span>“{text}”
      </p>
      <RuneRow active={working} className="runes-low" />
    </section>
  );
}

/**
 * One quest (/oracle/quest/:id): the wait while a road is drawn (or the moon while it waits for dawn), then
 * the scroll. Phase B: "Ask again" and its "Two roads" as carved tabs (the road inked furthest is the one the
 * quest keeps), Ask the stone on a waypoint.
 * Phase C: a quest shown to a crew opens read-only for its members, who can walk beside the Lorer.
 */
export function QuestPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const existing = !!(location.state as { existing?: boolean } | null)?.existing;
  const [background, setBackground] = useState(false);
  // The road on screen: null = the newest still drawing, else the one walked furthest; 'newest' right after "Ask again".
  const [picked, setPicked] = useState<string | null>(null);
  const wish = useWish(id, background);
  const mind = useLoracle().data?.mind;
  const full = wish.data;
  const road = full ? pickRoad(full, picked) : null;
  // The rest of the page reads one road as `wish.road`: the road on screen.
  const w: Wish | undefined = full && road && road.id !== full.road.id ? { ...full, road } : full;
  // "Tell me when it's sealed" follows the road being drawn now, not the one on screen (looking at another
  // road while the second draws must not turn it off); once none draws, the road on screen, as before.
  const live = full ? [...roadsOf(full)].reverse().find((r) => roadInProgress(r) && !roadAtDawn(r)) : undefined;
  const notice = useSealedNotice(full ? (live ? { ...full, road: live } : w) : undefined);
  useEffect(() => setBackground(notice.on), [notice.on]);
  const retry = useAction(() => api.post<Wish>(`/loracle/wishes/${id}/retry`), {
    set: (w) => (w && typeof w === 'object' && 'road' in w ? [['wish', id], w] : null),
  });

  if (wish.isLoading) return <Waking />;
  if (wish.error || !full || !w || !road)
    return (
      <div className="oracle-page">
        <PageError error={wish.error} />
      </div>
    );

  const roads = roadsOf(full);
  const many = roads.length > 1;
  const mine = isMine(full);
  const crew = sharedCrew(full);
  const dawn = roadAtDawn(road);
  const silent = isSilent(w);
  const drawn = !silent && isDrawn(w);
  const working = !silent && !drawn && !dawn && w.status !== 'moon' && w.road.status !== 'faded' && w.status !== 'faded';
  const anyDrawing = roads.some(roadInProgress);
  const panelId = `road-panel-${full.id}`;
  const canAsk = mine && full.status === 'revealed' && mind !== 'asleep';
  // "Try again" redraws the newest faded road (the server's rule), so it is offered only there.
  const newestFaded = roads.filter((r) => r.status === 'faded').at(-1);
  const canRetry = mine && (road.id === newestFaded?.id || (!many && full.status === 'faded'));
  const stoneLabel = mine ? L.wishLabel : fillLine(L.theirWish, { name: full.owner?.displayName ?? '' });

  const body = silent ? (
    many && full.status !== 'silent' ? (
      // A later road the stone would not draw: the wish and its other roads stay.
      <section className="stone-tablet silent-stone" role="status">
        <p className="stone-line">{L.silent}</p>
      </section>
    ) : (
      <section className="stone-tablet silent-stone" role="status">
        <p className="stone-line">{L.silent}</p>
        <Link to="/oracle" state={{ text: w.text }} className="btn btn-block stone-cast">
          {MORE.sayAgain}
        </Link>
        <BurnScroll wishId={w.id} />
      </section>
    )
  ) : drawn ? (
    <ScrollView
      wish={w}
      existing={existing}
      readOnly={!mine}
      only={crew ? <CrewCanSee wish={full} /> : undefined}
      after={mine ? <ShareLine wish={full} /> : <ViewerLine wish={full} />}
      sheetExtra={(wp) => <WaypointExtra wish={full} wp={wp} canAsk={canAsk} />}
      rowExtra={(wp) => <WalkerMarks walkers={walkersOf(wp)} />}
    />
  ) : dawn ? (
    <DawnWait mine={mine} />
  ) : mind === 'asleep' ? (
    <>
      <AsleepStone />
      <p className="stone-line center">{L.asleepWish}</p>
    </>
  ) : (
    <>
      {existing && <p className="stone-line center">{L.duplicateDrawing}</p>}
      <InkWait
        wish={w}
        notice={mine ? notice : { ...notice, available: false }}
        retrying={retry.isPending}
        retryError={retry.error}
        onRetry={canRetry ? () => retry.mutate(undefined) : undefined}
      />
    </>
  );

  return (
    <div className="oracle-page">
      <TopBar back="/oracle" title={L.title} />
      <QuestStone text={w.text} working={working} label={stoneLabel} />

      {full.status === 'fulfilled' && isDrawn(full) && (
        <Link to={`/oracle/quest/${full.id}/epic`} className="btn btn-block gold-btn epic-open">
          <Crown size={18} aria-hidden />
          <span>{L.epic}</span>
        </Link>
      )}

      {many ? (
        <>
          <RoadTabs wish={full} roads={roads} selected={road.id} onSelect={setPicked} panelId={panelId} />
          <div role="tabpanel" id={panelId} aria-labelledby={`road-tab-${road.id}`} className="road-panel">
            {body}
          </div>
        </>
      ) : (
        body
      )}

      {mine && drawn && full.status === 'revealed' && !anyDrawing && mind !== 'asleep' && <AskAgain wish={full} onAsked={() => setPicked('newest')} />}

      <p className="oracle-colophon">
        {L.checkBefore} The stone’s mind is Claude, by Anthropic; it can be wrong. You choose what you do, and you keep yourself
        safe.
      </p>
    </div>
  );
}

/**
 * The Epic (/oracle/quest/:id/epic): a wish come true, told as its map, every inked line leading to its
 * chapter. Crew members a quest was shown to read the same epic. Not fulfilled (yet, or any more): the scroll.
 */
export function EpicPage() {
  const { id = '' } = useParams();
  const epic = useEpic(id);
  if (epic.isLoading) return <Waking />;
  const error = epic.error as ApiError | null;
  if (error?.code === 'not_fulfilled')
    return (
      <div className="oracle-page">
        <TopBar back={`/oracle/quest/${id}`} title={L.title} />
        <section className="stone-tablet" role="status">
          <p className="stone-line">{L.epicNotYet}</p>
          <Link to={`/oracle/quest/${id}`} className="btn btn-block stone-cast">
            {L.epicBack}
          </Link>
        </section>
      </div>
    );
  if (error || !epic.data)
    return (
      <div className="oracle-page">
        <PageError error={error} />
      </div>
    );
  const e = epic.data;
  return (
    <div className="oracle-page">
      <TopBar back={`/oracle/quest/${e.id}`} title={L.title} />
      <QuestStone text={e.text} working={false} label={e.mine ? L.wishLabel : fillLine(L.theirWish, { name: e.owner.displayName })} />
      <EpicScroll epic={e} />
      <p className="oracle-colophon">{L.checkBefore}</p>
    </div>
  );
}
