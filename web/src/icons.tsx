/** A small stroke icon set, drawn inline so the app needs no icon font. */
import type {SVGProps} from 'react';

const PATHS: Record<string, string> = {
  dinner: 'M7 3v8a2 2 0 0 0 2 2v8M5 3v5a2 2 0 0 0 2 2M9 3v5M17 21V3c-2 1-3 3-3 6v4h3',
  ride: 'M5 17h14M6 17v2M18 17v2M4 13l2-6h12l2 6v4H4zM7.5 14h.01M16.5 14h.01',
  hotel: 'M3 20V6M21 20v-6a3 3 0 0 0-3-3H10v6M3 17h18M6.5 11.5h.01',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  x: 'M6 6l12 12M18 6L6 18',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  send: 'M4 12l16-8-6 16-2.5-6.5z',
  card: 'M3 6h18v12H3zM3 10h18M7 15h3',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 2h6l1-2h5',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  code: 'M9 8l-4 4 4 4M15 8l4 4-4 4',
};

export function Icon({name, size = 18, ...rest}: {name: string; size?: number} & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      <path d={PATHS[name] ?? PATHS.receipt} />
    </svg>
  );
}
