// The Loracle (/oracle): wishes first, wishes only. The Lorer tells the stones what they want; the
// stones answer with a road (a quest), drawn by the stone's mind on the server. The old tourist
// Futures (readings) are gone from the app; their routes and data stay on the server for exports.
import { Lock, Moon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  LORACLE_LINES,
  isoWeek,
  loracleExamples,
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
import { Embers, ReminderScroll, RuneRow, StoneCircle } from '../components/oracle.tsx';
import { PageError, Section, TopBar } from '../components/ui.tsx';
import { api, type ApiError } from '../lib/api.ts';
import { localTimeZone } from '../lib/dates.ts';
import { useAction, useLoracle, useWish } from '../lib/queries.ts';

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
  const examples = state.examples.length ? state.examples : loracleExamples(isoWeek(new Date()));

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
          examples={examples}
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

      {!still && (
        <p className="oracle-oath">
          <Lock size={16} aria-hidden /> {MORE.onlyYouAll}
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

/** One quest (/oracle/quest/:id): the wait while the road is drawn, then the scroll. */
export function QuestPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const existing = !!(location.state as { existing?: boolean } | null)?.existing;
  const [background, setBackground] = useState(false);
  const wish = useWish(id, background);
  const mind = useLoracle().data?.mind;
  const notice = useSealedNotice(wish.data);
  useEffect(() => setBackground(notice.on), [notice.on]);
  const retry = useAction(() => api.post<Wish>(`/loracle/wishes/${id}/retry`), {
    set: (w) => (w && typeof w === 'object' && 'road' in w ? [['wish', id], w] : null),
  });

  if (wish.isLoading) return <Waking />;
  if (wish.error || !wish.data)
    return (
      <div className="oracle-page">
        <PageError error={wish.error} />
      </div>
    );

  const w = wish.data;
  const silent = isSilent(w);
  const drawn = !silent && isDrawn(w);
  const working = !silent && !drawn && w.status !== 'moon' && w.road.status !== 'faded' && w.status !== 'faded';

  return (
    <div className="oracle-page">
      <TopBar back="/oracle" title={L.title} />
      <section className={`oracle-stone compact${working ? ' speaking sunk' : ''}`}>
        <div className="stone-window" aria-hidden>
          <StoneCircle active={working} />
          <Embers active={working} />
        </div>
        <p className="wish-carved">
          <span className="sr-only">{L.wishLabel}: </span>“{w.text}”
        </p>
        <RuneRow active={working} className="runes-low" />
      </section>

      {silent ? (
        <section className="stone-tablet silent-stone" role="status">
          <p className="stone-line">{L.silent}</p>
          <Link to="/oracle" state={{ text: w.text }} className="btn btn-block stone-cast">
            {MORE.sayAgain}
          </Link>
          <BurnScroll wishId={w.id} />
        </section>
      ) : drawn ? (
        <ScrollView wish={w} existing={existing} />
      ) : mind === 'asleep' ? (
        <>
          <AsleepStone />
          <p className="stone-line center">{L.asleepWish}</p>
        </>
      ) : (
        <>
          {existing && <p className="stone-line center">{L.duplicateDrawing}</p>}
          <InkWait wish={w} notice={notice} retrying={retry.isPending} retryError={retry.error} onRetry={() => retry.mutate(undefined)} />
        </>
      )}

      <p className="oracle-colophon">
        {L.checkBefore} The stone’s mind is Claude, by Anthropic; it can be wrong. You choose what you do, and you keep yourself
        safe.
      </p>
    </div>
  );
}
