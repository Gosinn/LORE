const STAR = 'M32 1L34.3 26.5L51.8 12.2L37.5 29.7L63 32L37.5 34.3L51.8 51.8L34.3 37.5L32 63L29.7 37.5L12.2 51.8L26.5 34.3L1 32L26.5 29.7L12.2 12.2L29.7 26.5Z';

/** An eight-point compass rose, north in vermilion. Decorative. Styles: .compass-rose in styles/map.css. */
export function CompassRose({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={`compass-rose ${className}`} aria-hidden>
      <circle cx="32" cy="32" r="22" className="cr-ring" />
      <circle cx="32" cy="32" r="18.5" className="cr-ring" />
      <path d={STAR} className="cr-star" />
      <path d="M32 1L34.3 26.5L32 32L29.7 26.5Z" className="cr-north" />
    </svg>
  );
}
