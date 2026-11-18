import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { Wordmark } from '../components/ui.tsx';

const UPDATED = '18 November 2026';

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
        The Loracle suggests possible futures from public data (weather, the sky, notable places). It can be wrong and it
        doesn’t know about road closures, opening hours, private land, tides or danger. You decide what you do and you’re
        responsible for your own safety: check conditions, follow local rules and respect the places you visit.
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
          <strong>The Loracle:</strong> the town or area you set as your realm (its approximate coordinates), how far you’d
          travel, your interests, and the futures The Loracle showed you.
        </li>
        <li>
          <strong>Safety:</strong> reports you send, and messages you write to us.
        </li>
        <li>
          <strong>Technical:</strong> a sign-in token (a cookie in browsers) so you stay signed in, the type of device it
          was created on, and short-lived server logs (including IP addresses) for security and fixing problems.
        </li>
      </ul>

      <h2>Who sees it</h2>
      <p>
        You decide: each plan, idea and chapter shows who can see it (only you, the people in it, your friends, or a crew).
        Your private calendar, notes, reminders and Loracle realm are only ever visible to you. If something is reported,
        the people who moderate LORE can see the reported content and the accounts involved, only to decide what to do.
      </p>

      <h2>Who helps us run LORE</h2>
      <ul>
        <li>
          <strong>Render</strong> runs the LORE server and <strong>Neon</strong> hosts the database (including photos),
          both in Frankfurt, Germany. They store data for us and may not use it for anything else.
        </li>
        <li>
          For The Loracle, our server asks public data services about the area around your realm:{' '}
          <strong>Wikidata</strong> (notable places), <strong>Open-Meteo</strong> (weather), <strong>NOAA</strong> (aurora
          forecast) and <strong>OpenStreetMap Nominatim</strong> (finding the town you type). They receive coordinates or
          the town name you searched for, never your name, account or device.
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
          Depending on where you live (for example in the EU, the UK or California), you also have the right to ask what
          we hold, to object, and to complain to your data protection authority.
        </li>
      </ul>

      <h2>Why we use it</h2>
      <p>
        To provide LORE as you asked for it (our agreement with you), to keep it safe and working (our legitimate interest
        in protecting people and the service), and to answer you when you write to us.
      </p>

      <h2>How long</h2>
      <p>
        As long as your account exists. Sign-in sessions expire after 60 days without use. Cached weather and place data
        isn’t linked to you. Messages to support are deleted with your account.
      </p>

      <h2>Children</h2>
      <p>LORE isn’t for children under 13. If you think a child has an account, tell us and we’ll remove it.</p>

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
