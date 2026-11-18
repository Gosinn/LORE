// The care floor: the one list of unmistakable phrases that always mean the care screen, checked in
// code before anything else (no mind, no consent, no realm, no limit needed). The route checks it
// first, the mind checks it again before it weighs, and the weighing's offers are held to it.
//
// The weighing catches the rest ("when unsure, care"). A false alarm costs one gentle screen with
// "I meant something else"; a miss could cost far more. The few guards below keep a quest that only
// mentions a word ("I wish to die old and happy on a mountain", "suicide prevention") out of it.
//
// Icelandic phrases are the owner's tongue; like the crisis lines, they are to be checked by a
// native speaker before release.

const FLOOR: readonly RegExp[] = [
  /\bkill(?:ing)? my ?self\b/,
  /\bend(?:ing)? (?:it all|my (?:own )?life)\b/,
  /\btake my (?:own )?life\b/,
  /\bsuicid(?:e|al)\b(?! (?:prevention|awareness|hotline|helpline|line|research|studies))/,
  /\b(?:want|wanted|wanna|wish|wishing|ready) to die\s*(?:$|[.!?,;]|now\b|tonight\b|today\b|already\b|soon\b)/,
  /\b(?:don'?t|do not) want to (?:be alive|live|wake up|exist)\b/,
  /\bwish (?:that )?i (?:was|were) dead\b/,
  /\bwish i(?: had|'d) never been born\b/,
  /\bwish i could (?:just )?(?:die|disappear|vanish|stop existing|not exist|sleep forever)\b/,
  /\bno (?:reason|point) (?:to|in) (?:live|living|go on|going on)\b/,
  /\bhurt(?:ing)? my ?self\b/,
  /\bcut(?:ting)? my ?self\b/,
  /\bself[- ]?harm/,
  /\bsvipta mig l[ií]fi\b/,
  /\bfyrirfara m[ée]r\b/,
  /\bsj[áa]lfsv[íi]g/,
  /\blangar a[ðd] deyja\b/,
  /\bvil ekki lifa\b/,
];

/** True when the words always mean the care screen. Case, curly apostrophes and spacing don't matter. */
export function careFloor(text: string): boolean {
  const t = text.normalize('NFKC').toLowerCase().replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ');
  return FLOOR.some((re) => re.test(t));
}
