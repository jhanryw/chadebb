import { ArrowDown } from "lucide-react";
import type { PublicEventConfig } from "@/lib/event-config";
import { Ornament } from "@/components/ui/Ornament";
import { buttonStyles } from "@/components/ui/button-styles";

export function Hero({ config }: { config: PublicEventConfig }) {
  return (
    <header className="relative flex min-h-[100svh] flex-col items-center justify-center px-6 py-16 text-center">
      <p className="rise text-xs font-medium uppercase tracking-[0.32em] text-taupe-deep sm:text-sm">
        Celebração de fé e gratidão
      </p>

      <h1 className="rise rise-2 mt-8 font-script text-[4.5rem] leading-[1.02] text-ink sm:text-[7rem]">
        Luiza ou{" "}
        <span className="block sm:inline">Augusto?</span>
      </h1>

      <Ornament className="rise rise-2 mt-8" />

      <p className="rise rise-3 mt-6 max-w-md font-serif text-2xl italic leading-snug text-stone sm:text-3xl">
        {config.subtitle}
      </p>

      <p className="rise rise-3 mt-8 text-lg tracking-wide text-ink">
        <time dateTime={config.eventDateISO}>{config.longDateLabel}</time>
      </p>
      <p className="rise rise-3 text-sm uppercase tracking-[0.25em] text-taupe-deep">
        {config.weekdayLabel} · {config.timeLabel}
      </p>

      <a href="#confirmar" className={`rise rise-3 mt-10 ${buttonStyles.primary}`}>
        Confirmar presença
      </a>

      <a
        href="#convite"
        aria-label="Rolar para o convite"
        className="absolute bottom-6 text-taupe-deep/70 hover:text-taupe-deep"
      >
        <ArrowDown aria-hidden="true" className="size-6" />
      </a>
    </header>
  );
}
