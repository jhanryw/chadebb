const base =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-8 py-3 text-base font-medium tracking-wide transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60";

export const buttonStyles = {
  primary: `${base} bg-ink text-ivory hover:bg-taupe-deep`,
  secondary: `${base} border border-taupe-deep/60 bg-paper/70 text-ink hover:bg-sand`,
} as const;
