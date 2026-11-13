/** Divisor discreto com cruz, usado entre as seções. Decorativo (oculto para leitores de tela). */
export function Ornament({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 160 24"
      className={`mx-auto h-6 w-40 text-taupe ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
    >
      <path d="M4 12h56M100 12h56" />
      <path d="M80 3v18M73 9h14" strokeWidth="1.4" />
      <circle cx="67" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="93" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}
