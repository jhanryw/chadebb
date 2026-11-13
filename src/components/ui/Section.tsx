import type { ReactNode } from "react";
import { Ornament } from "./Ornament";

interface SectionProps {
  id: string;
  title: string;
  children: ReactNode;
  /** Mostra o divisor decorativo acima do título. */
  ornament?: boolean;
}

export function Section({ id, title, children, ornament = true }: SectionProps) {
  const headingId = `${id}-titulo`;
  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-6 px-6 py-14 sm:py-20">
      <div className="mx-auto w-full max-w-2xl">
        {ornament && <Ornament className="mb-6" />}
        <h2
          id={headingId}
          className="mb-8 text-center font-script text-5xl leading-tight text-ink sm:text-6xl"
        >
          {title}
        </h2>
        {children}
      </div>
    </section>
  );
}
