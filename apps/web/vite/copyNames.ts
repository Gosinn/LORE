// Which names hold words people read (rewritten) and which hold code (never touched). Every JSX
// attribute or prop name that carries a literal with letters must be in one of these lists: the
// coverage test (vite/test/copyCoverage.test.ts) fails on a name in neither, so someone decides once.

/** DOM attributes (lowercase tags) whose value is shown or read aloud. */
export const TEXT_DOM_ATTRS: ReadonlySet<string> = new Set([
  'placeholder',
  'title',
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'aria-placeholder',
  'alt',
]);

/** `label` is shown only on these DOM elements. */
export const LABEL_DOM_TAGS: ReadonlySet<string> = new Set(['option', 'optgroup', 'track']);

/** Component props (capitalized or member tags) that carry words. Always rewritten to a string. */
export const TEXT_PROPS: ReadonlySet<string> = new Set([
  'title',
  'label',
  'hint',
  'placeholder',
  'aria-label',
  'alt',
  'note',
  'sub',
  'text',
  'description',
  'empty',
  'heading',
  'kicker',
  'cta',
  'message',
  'body',
  // Field's error line (shown under the input)
  'error',
]);

/** Attribute and prop names that hold code: never rewritten, literals there are not copy. */
export const CODE_PROPS: ReadonlySet<string> = new Set([
  // From the spec
  'className', 'style', 'to', 'href', 'src', 'id', 'htmlFor', 'type', 'role', 'name', 'value', 'key', 'variant',
  'size', 'kind', 'as', 'targetType', 'back', 'autoComplete', 'inputMode', 'accept', 'target', 'rel', 'tone',
  'icon', 'emoji', 'mode',
  // RuneGlyph's letter (a glyph id, drawn as a rune)
  'c',
  // DOM and form attributes
  'defaultValue', 'pattern', 'min', 'max', 'step', 'minLength', 'maxLength', 'rows', 'cols', 'loading', 'decoding',
  'method', 'action', 'encType', 'lang', 'dir', 'tabIndex', 'enterKeyHint', 'autoCapitalize', 'autoCorrect',
  'spellCheck', 'capture', 'download', 'form', 'list', 'datetime', 'dateTime', 'crossOrigin', 'referrerPolicy',
  'sizes', 'srcSet', 'width', 'height', 'wrap', 'scope', 'headers', 'colSpan', 'rowSpan', 'open', 'hidden',
  'inert', 'draggable', 'contentEditable', 'translate', 'popover', 'popoverTarget', 'slot', 'is', 'ref',
  'aria-hidden', 'aria-live', 'aria-current', 'aria-pressed', 'aria-expanded', 'aria-controls',
  'aria-describedby', 'aria-labelledby', 'aria-modal', 'aria-haspopup', 'aria-selected', 'aria-checked',
  'aria-disabled', 'aria-busy', 'aria-atomic', 'aria-orientation', 'aria-valuemin', 'aria-valuemax',
  'aria-valuenow', 'aria-relevant', 'aria-invalid', 'aria-required', 'aria-readonly', 'aria-owns',
  'aria-activedescendant', 'aria-level', 'aria-posinset', 'aria-setsize', 'aria-sort', 'aria-autocomplete',
  'aria-multiselectable', 'aria-errormessage', 'aria-details', 'aria-keyshortcuts',
  // SVG
  'd', 'viewBox', 'fill', 'stroke', 'transform', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'dx', 'dy', 'points', 'xmlns', 'preserveAspectRatio', 'strokeLinecap', 'strokeLinejoin', 'strokeWidth',
  'strokeDasharray', 'strokeDashoffset', 'strokeOpacity', 'fillOpacity', 'fillRule', 'clipRule', 'clipPath',
  'gradientUnits', 'gradientTransform', 'offset', 'stopColor', 'stopOpacity', 'opacity', 'filter', 'mask',
  'markerEnd', 'markerStart', 'textAnchor', 'dominantBaseline', 'pathLength', 'patternUnits',
  'patternContentUnits', 'stdDeviation', 'in', 'in2', 'result', 'operator', 'k1', 'k2', 'k3', 'k4', 'mode',
  'values', 'baseFrequency', 'numOctaves', 'seed', 'scale', 'xChannelSelector', 'yChannelSelector',
  'surfaceScale', 'specularExponent', 'specularConstant', 'lightingColor', 'azimuth', 'elevation',
  'floodColor', 'floodOpacity', 'kernelMatrix', 'type', 'tableValues', 'slope', 'intercept', 'amplitude',
  'exponent', 'radius', 'fontSize', 'fontWeight', 'fontFamily', 'letterSpacing', 'vectorEffect', 'href',
  'xlinkHref', 'focusable', 'shapeRendering', 'colorInterpolationFilters', 'fx', 'fy', 'spreadMethod',
  'lengthAdjust', 'textLength', 'startOffset', 'side', 'method', 'spacing', 'rotate',
  // Icon (lucide) and router (Link, NavLink) props
  'absoluteStrokeWidth', 'color', 'end', 'replace', 'state', 'preventScrollReset', 'viewTransition', 'discover',
  'prefetch', 'reloadDocument', 'relative', 'caseSensitive', 'path', 'index', 'element',
]);

/** Object keys whose text values are copy (rule 8): getters at module level, `__t` inside functions. */
export const TEXT_KEYS: ReadonlySet<string> = new Set([
  'label',
  'title',
  'text',
  'hint',
  'sub',
  'description',
  'placeholder',
  'empty',
  'body',
  'heading',
  'cta',
  'note',
  'message',
  'kicker',
]);

/** Object keys that hold code, even inside a copy table (rule 9). */
export const CODE_KEYS: ReadonlySet<string> = new Set([
  'to',
  'href',
  'icon',
  'emoji',
  'emblem',
  'code',
  'number',
  'id',
  'value',
  'key',
  'type',
  'kind',
  'tone',
  'url',
  // HTTP headers
  'authorization',
  'Authorization',
]);

/** Children of these DOM elements are always plain strings (string mode). */
export const STRING_ONLY_PARENTS: ReadonlySet<string> = new Set(['option', 'title', 'textarea', 'text', 'tspan', 'textPath']);

/** Inline tags that may sit inside a message (no attributes, only text inside). */
export const INLINE_TAGS: ReadonlySet<string> = new Set(['em', 'strong', 'b', 'i', 'u', 'small', 'mark', 'br']);

/** Nothing under these DOM elements is copy. (`textarea` attributes still are: its placeholder.) */
export const SKIP_TAGS: ReadonlySet<string> = new Set(['code', 'pre', 'kbd', 'script', 'style', 'textarea']);

/** Functions whose first argument is shown to the person (rule 5). */
export const SINKS: ReadonlySet<string> = new Set(['confirm', 'alert', 'prompt']);

/**
 * Module-level constants that are tables (rule 9) although their name doesn't say so and their file
 * belongs to another layer. Prefer `// copy:table` in the source.
 */
export const TABLE_NAMES: ReadonlySet<string> = new Set(['LORACLE_EXAMPLES']);

/**
 * Safety data: never editable live (spec section 9), even though `CRISIS_LINES` ends in `_LINES`.
 * Numbers and names must be checked against each line's own site; a typo could send someone in
 * danger to a wrong number.
 */
export const NEVER_TABLES: ReadonlySet<string> = new Set(['CRISIS_LINES', 'EMERGENCY_NUMBERS', 'FIND_A_HELPLINE', 'EU_EEA_112']);

/** Table entries used as data as well as words: overridable, never marked (`// copy:plain`). */
export const PLAIN_PATHS: ReadonlySet<string> = new Set(['LORACLE_LINES.wishStart']);

/** Table entries that are promises people agreed to: flagged `legal` in the catalog (section 9). */
export const LEGAL_PATH = /^LORACLE_LINES\.(consent\w*|privacy)$/;

/**
 * Calls whose string arguments are code (selectors, storage keys, routes, formats). A literal passed
 * to a call not listed here must be copy, an annotation, or code-shaped.
 */
export const CODE_CALLS: ReadonlySet<string> = new Set([
  // app helpers
  'api', 'get', 'post', 'put', 'patch', 'del', 'delete', 'upload', 'qs', 'navigate', 'page', 'mediaSrc', 'useQuery',
  'useMutation', 'invalidateQueries', 'setQueryData', 'getQueryData', 'removeQueries', 'useParams',
  'useSearchParams', 'setSearchParams', 'redirect', 'Navigate', 'lazy', 'useNavigate',
  // storage and DOM
  'getItem', 'setItem', 'removeItem', 'matchMedia', 'querySelector', 'querySelectorAll', 'closest', 'matches',
  'getElementById', 'createElement', 'createElementNS', 'setAttribute', 'getAttribute', 'removeAttribute',
  'hasAttribute', 'toggleAttribute', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'add', 'remove',
  'toggle', 'contains', 'setProperty', 'getPropertyValue', 'removeProperty', 'scrollTo', 'scrollIntoView', 'focus',
  'execCommand', 'postMessage', 'open', 'assign', 'pushState', 'replaceState', 'CustomEvent', 'Event',
  // strings, numbers, dates, data
  'split', 'join', 'replace', 'replaceAll', 'startsWith', 'endsWith', 'includes', 'indexOf', 'lastIndexOf',
  'padStart', 'padEnd', 'match', 'matchAll', 'search', 'test', 'exec', 'RegExp', 'localeCompare', 'normalize',
  'toLocaleDateString', 'toLocaleTimeString', 'toLocaleString', 'DateTimeFormat', 'NumberFormat',
  'RelativeTimeFormat', 'PluralRules', 'DisplayNames', 'ListFormat', 'Collator', 'Segmenter', 'supportedValuesOf',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'fetch', 'URL', 'URLSearchParams', 'Date',
  'parse', 'stringify', 'Blob', 'File', 'FormData', 'Request', 'Response', 'Headers', 'toBlob', 'toDataURL',
  'getContext', 'Image', 'createImageBitmap', 'canPlayType', 'Set', 'Map', 'has', 'set', 'fill', 'Symbol', 'for',
  'Intl', 'Number', 'parseInt', 'parseFloat', 'toFixed', 'Array', 'from', 'BigInt', 'atob', 'btoa', 'TextEncoder',
  'TextDecoder', 'digest', 'importKey', 'require', 'import', 'getComputedStyle', 'animate', 'Animation',
  'ResizeObserver', 'IntersectionObserver', 'MutationObserver', 'requestAnimationFrame', 'setTimeout', 'setInterval',
  // logging and tooling
  'log', 'warn', 'error', 'info', 'debug', 'trace', 'assert', 'time', 'timeEnd', 'group', 'groupEnd',
  // Capacitor
  'addListener', 'registerPlugin', 'isPluginAvailable', 'getPlatform', 'isNativePlatform', 'Browser',
  // the copy layer itself
  'fillLine', 'hashText',
]);
