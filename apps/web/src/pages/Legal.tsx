import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { copy } from '#shared';
import { Wordmark } from '../components/ui.tsx';

/** Editable live, read once at start (a module constant): reload to see an edit. */
const UPDATED = copy('18 November 2026');

/** A page anyone can open, signed in or not (the App Store links here). */
export function PublicPage({ title, children }: { title: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="legal">
      <header className="legal-head">
        <button className="icon-btn" onClick={() => (history.length > 1 ? navigate(-1) : navigate('/'))} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <Link to="/" aria-label="LORE home">
          <Wordmark tag={false} />
        </Link>
      </header>
      <article className="legal-body">
        <h1>{title}</h1>
        {children}
        <p className="legal-links small muted">
          <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link> · <Link to="/support">Help &amp; contact</Link>
        </p>
      </article>
    </div>
  );
}

export function TermsPage() {
  return (
    <PublicPage title="Terms of Use">
      <p className="small muted">Last updated {UPDATED}</p>
      <p>
        LORE (Life Of Regular Epics) is an app for planning real-life adventures with your people and keeping the story of
        what happened. It’s made and run by its developer, Gosinn (“we”). By creating an account you agree to these terms.
      </p>

      <h2>Who can use LORE</h2>
      <p>
        You must be at least 13, and old enough where you live to agree to these terms yourself. One person per account.
        Keep your password to yourself; you’re responsible for what happens on your account.
      </p>

      <h2>Your lore is yours</h2>
      <p>
        You own what you put into LORE: plans, ideas, chapters, stories, photos, notes. You give us permission to store
        it and show it to the people you chose to share it with, only so that LORE can work. We don’t sell it, and we
        don’t use it for ads. You can download everything or delete your account at any time from your profile.
      </p>

      <h2>No tolerance for abuse</h2>
      <p>LORE is for real friends and real adventures. You may not use it to post or send:</p>
      <ul>
        <li>harassment, bullying, threats, or anything meant to hurt or scare someone;</li>
        <li>hate against people for who they are;</li>
        <li>sexual content involving anyone without their consent, and anything sexual involving minors, ever;</li>
        <li>violence, or encouraging anyone to hurt themselves or others;</li>
        <li>spam, scams, or impersonating someone;</li>
        <li>other people’s private information or photos without their permission;</li>
        <li>anything illegal, or that infringes someone else’s rights.</li>
      </ul>
      <p>
        Anyone can <strong>report</strong> a person or anything they can see, and <strong>block</strong> people. We review
        reports within 24 hours. Content that breaks these rules is removed, and the account behind it can be suspended
        without warning.
      </p>

      <h2>The Loracle and real-world adventures</h2>
      <p>
        The Loracle draws imaginative quests from public web pages, with the help of Claude, an AI made by Anthropic. They
        can be out of date or wrong, and they may name real public people and places. Check every step with the people and
        places themselves before you go. Approach people respectfully, through their public channels, and take no for an
        answer.
      </p>
      <p>
        Dangerous roads (combat sports, mountains, the sea) need training, medical checks, insurance and qualified guides;
        you decide what you do and you’re responsible for your own safety. The Loracle never gives medical, legal or
        financial advice. If you’re under 18, walk any far or risky road with a parent or guardian.
      </p>
      <p>
        Don’t put other people’s private details in a wish, and don’t use The Loracle to plan harm to anyone, yourself
        included. If a wish sounds like you might be in danger, The Loracle stops and shows you a helpline instead.
      </p>

      <h2>Buying LORE</h2>
      <p>
        On the App Store, LORE is sold by Apple on our behalf, under Apple’s terms. Refunds go through Apple. Apple isn’t
        responsible for LORE itself or for supporting it; we are.
      </p>

      <h2>Changes and availability</h2>
      <p>
        LORE is young and keeps growing. Features may change. We’ll tell you in the app before these terms change in an
        important way. We work hard to keep LORE running and your lore safe, but we can’t promise it will never be down or
        that nothing will ever go wrong; to the extent the law allows, we aren’t liable for indirect losses. Nothing here
        takes away rights you have under consumer law where you live.
      </p>

      <h2>Leaving</h2>
      <p>
        You can delete your account whenever you like (Profile → Your data). We may suspend or close accounts that break
        these terms. Things you shared with others stay part of their story, credited to “a former member”.
      </p>

      <h2>Contact</h2>
      <p>
        Questions, problems or appeals: <Link to="/support">write to us</Link>.
      </p>
    </PublicPage>
  );
}

export function PrivacyPage() {
  return (
    <PublicPage title="Privacy Policy">
      <p className="small muted">Last updated {UPDATED}</p>
      <p>
        LORE is private by default: what you add is visible only to you until you choose to share it. We collect only
        what LORE needs to work, we never sell it, and there are no ads, trackers or analytics in LORE.
      </p>

      <h2>What we keep</h2>
      <ul>
        <li>
          <strong>Your account:</strong> name, username, email address, password (stored only as a scrambled hash, never
          readable), profile picture and bio if you add them, when you agreed to the Terms.
        </li>
        <li>
          <strong>What you create:</strong> plans, RSVPs, ideas, crews, chapters, stories, quotes, photos, comments, your
          private calendar, notes and reminders.
        </li>
        <li>
          <strong>The Loracle:</strong> where you stand (its town’s name, country and approximate coordinates), how far
          you’d go, what calls to you, and whatever you choose to tell the stone about yourself (age band, money, time,
          body, languages, passport). Where you stand is the town you name or, if you choose “Allow location”, your
          device’s position rounded on the device to about a kilometre (never the exact point). Your device asks you first,
          and you can always name a town instead. Each day’s sign on Home (one thing worth doing near you, and whether you
          chose it or waved it away) is kept with your readings until you delete your account, and so are the possible
          futures LORE showed before wishes came. All of it is in your download.
        </li>
        <li>
          <strong>The Loracle (wishes):</strong> the wishes you write, what the stone read in each one (the wish beneath it,
          who goes with you, what can’t wait, and short marks such as “dangerous” or “young”), the quests it draws for you
          (roads, waypoints and the public web pages it found), your notes and progress on them, and when you agreed to send
          wishes to Anthropic. All of it is in your download. For running costs we also record, for each request, the date,
          how long it took and what it cost, never its text.
        </li>
        <li>
          <strong>Safety:</strong> reports you send, and messages you write to us.
        </li>
        <li>
          <strong>Technical:</strong> a sign-in token (a cookie in browsers) so you stay signed in, the type of device it
          was created on, and short-lived server logs (including IP addresses) for security and fixing problems.
        </li>
      </ul>

      <h2>Wishes are yours alone</h2>
      <p>
        A wish can say a lot about you: your health, your hopes, your family, what you believe. We treat wishes and what you
        tell the stone as sensitive. Only you can see them, they are used for nothing but drawing your quests, and they go
        to Anthropic only after you agree on the sheet shown before your first wish. Don’t put other people’s private
        details in a wish.
      </p>

      <h2>Who sees it</h2>
      <p>
        You decide: each plan, idea and chapter shows who can see it (only you, the people in it, your friends, or a crew).
        Your private calendar, notes, reminders, wishes, quests and what you told The Loracle are only ever visible to
        you. If something is reported, the people who moderate LORE can see the reported content and the accounts involved, only to decide what to do.
      </p>

      <h2>Who helps us run LORE</h2>
      <ul>
        <li>
          <strong>Render</strong> runs the LORE server and <strong>Neon</strong> hosts the database (including photos),
          both in Frankfurt, Germany. They store data for us and may not use it for anything else.
        </li>
        {/* OWNER: before publishing, check the retention period, the no-training term and the transfer basis below
            against Anthropic's current Commercial Terms and Data Processing Addendum (spec §6.2). Not verified. */}
        <li>
          <strong>Anthropic</strong> (USA) runs Claude, the mind behind The Loracle. When you cast a wish, our server sends
          it your wish, what you told the stone about yourself, your town, its country and time zone, how far you’d go, what
          calls to you and the date; never your name, username, email, contacts or other LORE content. The searches The Loracle runs
          go to the web through Anthropic’s search provider and carry words from your wish and your town. Anthropic
          processes this to answer you, doesn’t use it to train its models, and deletes it after a limited period. We send a
          random code instead of your account, so abuse can be stopped without identifying you. Transfers to the USA rely on
          Anthropic’s data processing terms and standard contractual clauses.
        </li>
        <li>
          <strong>OpenStreetMap Nominatim</strong> finds the town you type for The Loracle, or the town at your rounded
          location (about a kilometre, never the exact point), and the places on a quest’s map. Our server asks it, so it
          receives only that town or place name or rounded point, never your name, account or device.
        </li>
        <li>
          <strong>Apple</strong> handles buying LORE on the App Store under its own privacy policy. We don’t receive your
          payment details.
        </li>
      </ul>
      <p>We never sell or rent your data, and we don’t share it with advertisers or data brokers.</p>

      <h2>Your choices and rights</h2>
      <ul>
        <li>
          <strong>Download</strong> everything you’ve put into LORE as a file: Profile → Your data.
        </li>
        <li>
          <strong>Delete</strong> your account: Profile → Your data. Your private things are erased; things you shared stay
          in other people’s chapters credited to “a former member”. Copies in backups disappear as the backups expire.
        </li>
        <li>
          <strong>Correct</strong> your details in your profile, and change who can see each thing at any time.
        </li>
        <li>
          <strong>Stop sending wishes</strong> to Anthropic at any time, on The Loracle’s page or in Profile → Your data. Nothing
          more of yours is sent: a wish still waiting to be read fades instead. Your scrolls stay until you delete them.
        </li>
        <li>
          <strong>Burn</strong> any quest: it is deleted at once.
        </li>
        <li>
          Depending on where you live (for example in the EU, the UK or California), you also have the right to ask what
          we hold, to object, and to complain to your data protection authority.
        </li>
      </ul>

      <h2>Why we use it</h2>
      <p>
        To provide LORE as you asked for it (our agreement with you), to keep it safe and working (our legitimate interest
        in protecting people and the service), and to answer you when you write to us. Wishes, and what you tell the stone
        about yourself, go to Anthropic only with your explicit consent, which you can take back at any time.
      </p>

      <h2>How long</h2>
      <p>
        As long as your account exists; a quest until you burn it. Sign-in sessions expire after 60 days without use.
        Cached weather and place data isn’t linked to you. Messages to support are deleted with your account.
      </p>

      <h2>Children</h2>
      <p>
        LORE isn’t for children under 13. If you think a child has an account, tell us and we’ll remove it. When you tell
        The Loracle you’re 13 to 17, it keeps its roads fit for your age and asks you to bring a parent or guardian.
      </p>

      <h2>Security</h2>
      <p>
        Everything travels encrypted (HTTPS). Passwords are hashed with scrypt. Photo links are signed and expire. Privacy
        rules are enforced on the server, not just hidden in the app.
      </p>

      <h2>Changes and contact</h2>
      <p>
        If this policy changes in an important way, we’ll tell you in the app. Questions or requests:{' '}
        <Link to="/support">write to us</Link>. LORE is run by its developer, Gosinn.
      </p>
    </PublicPage>
  );
}
