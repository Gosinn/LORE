// Get back into a LORE account: find it by username or email and give it a new
// password, straight in the database. For the person who runs the server.
//
//   npm run account:recover                    the live database (asks for its address)
//   npm run account:recover -- --local         the development database on this computer
//
// The database address and the password are typed into this terminal only, never
// shown and never saved. Deliberately doesn't read .env: a production address there
// would point the development server at the live data.
import { randomInt } from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline';
import { openDatabase } from './db/index.ts';
import { countAccounts, findAccounts, resetPassword, type FoundAccount } from './lib/recovery.ts';

const LIVE_URL = 'https://lore-g8co.onrender.com';

// --- Terminal input ------------------------------------------------------------------

const tty = !!process.stdin.isTTY && typeof process.stdin.setRawMode === 'function';
let lines: AsyncIterator<string> | null = null;

/** Ask a question. Hidden answers aren't echoed (when this is a real terminal). */
async function ask(question: string, hidden = false): Promise<string> {
  if (!tty) {
    process.stdout.write(question);
    lines ??= readline.createInterface({ input: process.stdin, terminal: false })[Symbol.asyncIterator]();
    const next = await lines.next();
    if (!hidden) process.stdout.write(`${next.value ?? ''}\n`);
    else process.stdout.write('\n');
    return next.done ? '' : next.value.trim();
  }
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    let value = '';
    const finish = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      resolve(value.trim());
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish();
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          process.stdout.write('\nStopped. Nothing was changed.\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value) {
            value = value.slice(0, -1);
            if (!hidden) process.stdout.write('\b \b');
          }
          continue;
        }
        if (ch < ' ') continue;
        value += ch;
        if (!hidden) process.stdout.write(ch);
      }
    };
    stdin.on('data', onData);
  });
}

const yes = (answer: string) => /^(y|yes|j|já|ja)$/i.test(answer);

// --- Recovery ----------------------------------------------------------------------------

const day = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const describe = (a: FoundAccount) =>
  `@${a.username}  ·  ${a.displayName}  ·  ${a.email}  ·  joined ${day(a.createdAt)}${a.suspendedAt ? '  ·  SUSPENDED' : ''}`;

/** Readable but strong: four groups of four, e.g. "kipa-rosu-te7l-mavo". */
function randomPassword() {
  const letters = 'abcdefghijkmnopqrstuvwxyz23456789';
  return Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => letters[randomInt(letters.length)]).join('')).join('-');
}

async function main() {
  const local = process.argv.includes('--local');
  console.log('\nLORE · get back into an account\n');

  let url: string | undefined;
  if (!local) {
    url = process.env.DATABASE_URL;
    if (!url) {
      console.log('Paste the live database address. Find it in Render → your LORE service → Environment →');
      console.log('DATABASE_URL (click the eye, then copy), or in Neon → your project → Connect.');
      console.log('Paste it here (right-click or Ctrl+V). It stays hidden.\n');
      url = await ask('Database address: ', true);
    }
    if (!/^postgres(ql)?:\/\//.test(url)) {
      console.log('\nThat doesn’t look like a database address (it starts with postgresql://). Nothing was changed.');
      process.exit(1);
    }
  }

  const database = await openDatabase(
    local ? { pgliteDir: process.env.PGLITE_DIR ?? path.resolve('.data', 'pglite') } : { url },
  );
  try {
    let total: number;
    try {
      total = await countAccounts(database.db);
    } catch (err) {
      console.log(`\nCouldn’t open the database: ${(err as Error).message}`);
      console.log('Check the address (copy it again) and that this computer is online. Nothing was changed.');
      process.exitCode = 1;
      return;
    }
    console.log(`\nConnected to the ${local ? 'development' : 'live'} database (${total} ${total === 1 ? 'account' : 'accounts'}).\n`);

    let account: FoundAccount | null = null;
    for (let attempt = 0; attempt < 5 && !account; attempt++) {
      const query = await ask('Your username, email, or name (Enter on its own to stop): ');
      if (!query) break;
      const { exact, accounts } = await findAccounts(database.db, query);
      if (exact) {
        account = accounts[0]!;
      } else if (accounts.length === 0) {
        console.log('  No account matches that. Try your email address, or part of your name.\n');
      } else {
        console.log('  Close matches:');
        accounts.forEach((a, i) => console.log(`   ${i + 1}. ${describe(a)}`));
        const pick = await ask('  Which one is yours? Number, or Enter to search again: ');
        const n = Number(pick);
        if (Number.isInteger(n) && n >= 1 && n <= accounts.length) account = accounts[n - 1]!;
        console.log('');
      }
    }
    if (!account) {
      console.log('\nNo account chosen. Nothing was changed.');
      return;
    }

    console.log(`\nFound:  ${describe(account)}`);
    if (account.suspendedAt) console.log('This account is suspended by a moderator; a new password won’t lift that.');
    if (!yes(await ask(`\nGive @${account.username} a new password and sign it out everywhere? (y/n) `))) {
      console.log('Nothing was changed.');
      return;
    }

    let password = '';
    let generated = false;
    while (!password) {
      const first = await ask('New password (at least 10 characters; Enter on its own makes one up for you): ', true);
      if (!first) {
        password = randomPassword();
        generated = true;
        break;
      }
      if (first.length < 10) {
        console.log('  At least 10 characters, please.');
        continue;
      }
      const again = await ask('Same password again: ', true);
      if (again !== first) {
        console.log('  Those weren’t the same. Once more.');
        continue;
      }
      password = first;
    }

    const { signedOut } = await resetPassword(database.db, account.id, password);
    console.log(`\nDone. @${account.username} has a new password.`);
    if (generated) console.log(`It is:  ${password}\n(Shown only this once. Write it down, or sign in and keep it in your password manager.)`);
    if (signedOut) console.log(`Signed out of ${signedOut} ${signedOut === 1 ? 'device' : 'devices'}.`);
    console.log(`Sign in ${local ? 'on the development server' : `at ${LIVE_URL}`} with "${account.username}" or ${account.email}.\n`);
  } finally {
    await database.close();
  }
}

main().catch((err) => {
  console.error(`\nSomething went wrong: ${(err as Error).message}\nNothing more was changed.`);
  process.exit(1);
});
