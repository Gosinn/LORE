// Live text editor: where a text lives, in plain words ("Event page › field name"), for the owner who doesn't
// read code. The catalog's own context ("EventFormInner › Field label") stays available as a tooltip.
import { keyScope, SERVER_SCOPE, VOCABULARY_SCOPE } from '#shared/copy';

/** Screens and parts of LORE whose file names don't say it plainly. */
const SCREENS: Record<string, string> = {
  'pages/Home': 'Home',
  'pages/Oracle': 'The Loracle',
  'pages/Legal': 'Terms and Privacy',
  'pages/WhereYouStand': 'Where do you stand?',
  'pages/NotFound': 'Lost page',
  'pages/Lorebook': 'Lorebook',
  'pages/Profile': 'Profile',
  'components/AppShell': 'Menus and tab bar',
  'components/ui': 'Everywhere',
  'components/loracle': 'The Loracle',
  'components/oracle': 'The Loracle',
  'components/cards': 'Cards',
  'components/notes': 'Notes',
  'components/report': 'Report sheet',
  'components/pickers': 'Pickers',
  'components/CommentThread': 'Comments',
  'lib/api': 'Connection messages',
  'lib/dates': 'Dates and times',
  'lib/reminders': 'Reminders',
  'lib/theme': 'Looks',
  [SERVER_SCOPE]: 'Message from the server',
  [VOCABULARY_SCOPE]: 'Word list',
};

/** Whole contexts (or their last part) the catalog writes, in plain words. '' = the screen says it all. */
const PARTS: Record<string, string> = {
  'Field label': 'field name',
  'Field hint': 'field hint',
  'Field error': 'field error',
  'Section title': 'section heading',
  'TopBar title': 'top bar title',
  'Sheet title': 'sheet title',
  'Empty title': 'when there’s nothing yet',
  'PublicPage title': 'page title',
  'Person sub': 'line under a name',
  'EventCard note': 'card note',
  'Server message': '',
  'Server message (field)': 'field message',
  'Server text (copy)': 'notification or sign',
  'Input check': 'form check',
  'placeholder default': 'hint in a box',
  'copy()': '',
  'copy.list()': '',
  confirm: 'confirm dialog',
  message: 'message',
};

/** HTML elements and link components. */
const TAGS: Record<string, string> = {
  h1: 'title',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  p: 'text',
  span: 'words',
  strong: 'words',
  em: 'words',
  b: 'words',
  i: 'words',
  small: 'small print',
  fragment: 'words',
  text: 'words',
  div: 'words',
  li: 'list item',
  summary: 'fold-out heading',
  a: 'link',
  Link: 'link',
  NavLink: 'link',
  button: 'button',
  label: 'field name',
  option: 'choice',
  legend: 'group name',
  title: 'tooltip',
};

const ATTRS: Record<string, string> = {
  'aria-label': 'label for screen readers',
  placeholder: 'hint in a box',
  title: 'tooltip',
  alt: 'picture description',
};

const words = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** The screen or part of LORE a key belongs to. */
export function screenOf(key: string): string {
  const scope = keyScope(key);
  const known = SCREENS[scope];
  if (known) return known;
  const name = cap(words(scope.split('/').pop() ?? scope));
  return scope.startsWith('pages/') && !/ (page|form)$/.test(name) ? `${name} page` : name;
}

/** What kind of text the catalog's context describes ('' when the screen says enough). */
export function partOf(ctx: string): string {
  const tail = ctx.includes(' › ') ? ctx.slice(ctx.lastIndexOf(' › ') + 3) : ctx;
  if (tail in PARTS) return PARTS[tail]!;
  if (/^[A-Z][A-Z0-9_]*(?:[.[]|$)/.test(tail)) return 'list of words'; // LORACLE_LINES.cast, MORE.inkedOn, DOW[0]
  const attr = /^(\S+) (aria-label|placeholder|title|alt)$/.exec(tail);
  if (attr) {
    // A component's own title prop ("Foo title") is a title; an element's title attribute is a tooltip.
    if (attr[2] === 'title' && /^[A-Z]/.test(attr[1]!)) return 'title';
    return ATTRS[attr[2]!]!;
  }
  if (TAGS[tail]) return TAGS[tail];
  return words(tail.replace(/^\S+ (?=[a-z])/, ''));
}

/** "Event page › field name": where a text lives, for people. `ctx`: the catalog's (or a stored) context. */
export function whereLabel(key: string, ctx?: string | null): string {
  const screen = screenOf(key);
  const part = ctx ? partOf(ctx) : '';
  return part ? `${screen} › ${part}` : screen;
}
