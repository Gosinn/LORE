// JSX text the way React sees it: entities decoded, then whitespace cleaned exactly as the JSX
// transform does (Babel's cleanJSXElementLiteralChild, which oxc follows). The oxc-equivalence test
// in vite/test/copyTransform.test.ts is the arbiter.

/** Clean one JSX text child. "" means React renders nothing for it. */
export function cleanJsxText(value: string): string {
  const lines = value.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  lines.forEach((l, i) => {
    if (/[^ \t]/.test(l)) lastNonEmpty = i;
  });
  let out = '';
  lines.forEach((line, i) => {
    let t = line.replace(/\t/g, ' ');
    if (i !== 0) t = t.replace(/^[ ]+/, '');
    if (i !== lines.length - 1) t = t.replace(/[ ]+$/, '');
    if (t) out += i === lastNonEmpty ? t : `${t} `;
  });
  return out;
}

/**
 * JSX attribute strings: entities decoded, then a newline and the indentation after it become one
 * space (what the JSX transform does to multi-line attribute strings).
 */
export function cleanJsxAttr(value: string): string {
  return value.replace(/\n\s+/g, ' ');
}

/** The XHTML entities JSX knows (the same table Babel's parser uses). */
const LATIN1 =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute ' +
  'micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring ' +
  'AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml ' +
  'times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil ' +
  'egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ' +
  'ugrave uacute ucirc uuml yacute thorn yuml';

const GREEK_UPPER = 'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho';
const GREEK_UPPER2 = 'Sigma Tau Upsilon Phi Chi Psi Omega';
const GREEK_LOWER =
  'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau ' +
  'upsilon phi chi psi omega';

const OTHERS: Record<string, number> = {
  quot: 34, amp: 38, apos: 39, lt: 60, gt: 62,
  OElig: 338, oelig: 339, Scaron: 352, scaron: 353, Yuml: 376, fnof: 402, circ: 710, tilde: 732,
  thetasym: 977, upsih: 978, piv: 982,
  ensp: 8194, emsp: 8195, thinsp: 8201, zwnj: 8204, zwj: 8205, lrm: 8206, rlm: 8207, ndash: 8211, mdash: 8212,
  lsquo: 8216, rsquo: 8217, sbquo: 8218, ldquo: 8220, rdquo: 8221, bdquo: 8222, dagger: 8224, Dagger: 8225,
  bull: 8226, hellip: 8230, permil: 8240, prime: 8242, Prime: 8243, lsaquo: 8249, rsaquo: 8250, oline: 8254,
  frasl: 8260, euro: 8364, image: 8465, weierp: 8472, real: 8476, trade: 8482, alefsym: 8501,
  larr: 8592, uarr: 8593, rarr: 8594, darr: 8595, harr: 8596, crarr: 8629,
  lArr: 8656, uArr: 8657, rArr: 8658, dArr: 8659, hArr: 8660,
  forall: 8704, part: 8706, exist: 8707, empty: 8709, nabla: 8711, isin: 8712, notin: 8713, ni: 8715,
  prod: 8719, sum: 8721, minus: 8722, lowast: 8727, radic: 8730, prop: 8733, infin: 8734, ang: 8736,
  and: 8743, or: 8744, cap: 8745, cup: 8746, int: 8747, there4: 8756, sim: 8764, cong: 8773, asymp: 8776,
  ne: 8800, equiv: 8801, le: 8804, ge: 8805, sub: 8834, sup: 8835, nsub: 8836, sube: 8838, supe: 8839,
  oplus: 8853, otimes: 8855, perp: 8869, sdot: 8901, lceil: 8968, rceil: 8969, lfloor: 8970, rfloor: 8971,
  lang: 9001, rang: 9002, loz: 9674, spades: 9824, clubs: 9827, hearts: 9829, diams: 9830,
};

export const ENTITIES: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  LATIN1.split(' ').forEach((n, i) => m.set(n, String.fromCodePoint(160 + i)));
  GREEK_UPPER.split(' ').forEach((n, i) => m.set(n, String.fromCodePoint(913 + i)));
  GREEK_UPPER2.split(' ').forEach((n, i) => m.set(n, String.fromCodePoint(931 + i)));
  GREEK_LOWER.split(' ').forEach((n, i) => m.set(n, String.fromCodePoint(945 + i)));
  for (const [n, cp] of Object.entries(OTHERS)) m.set(n, String.fromCodePoint(cp));
  return m;
})();

/**
 * Decode `&name;`, `&#123;` and `&#x1F;`. Returns null when the text holds an `&…;` that isn't a
 * known entity (the caller leaves that text alone and reports it: never guess).
 */
export function decodeEntities(value: string): string | null {
  if (!value.includes('&')) return value;
  let unknown = false;
  const out = value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#x')) return codePoint(parseInt(body.slice(2), 16)) ?? ((unknown = true), whole);
    if (body.startsWith('#')) return codePoint(parseInt(body.slice(1), 10)) ?? ((unknown = true), whole);
    const hit = ENTITIES.get(body);
    if (hit === undefined) unknown = true;
    return hit ?? whole;
  });
  return unknown ? null : out;
}

function codePoint(n: number): string | null {
  return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : null;
}
