"use client";

import { useEffect, useState } from "react";
import { Section } from "@/components/ui/Section";

interface CountdownProps {
  /** Instante absoluto do início do evento (ISO 8601 com fuso, ex.: 2026-11-22T08:00:00-03:00). */
  targetISO: string;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Depois deste tempo do início, a mensagem passa de "em andamento" para "obrigado". */
const EVENT_WINDOW = 12 * HOUR;

export function splitDuration(diffMs: number) {
  const safe = Math.max(0, diffMs);
  return {
    days: Math.floor(safe / DAY),
    hours: Math.floor((safe % DAY) / HOUR),
    minutes: Math.floor((safe % HOUR) / MINUTE),
    seconds: Math.floor((safe % MINUTE) / SECOND),
  };
}

/**
 * Contagem regressiva.
 *
 * - O alvo é um instante absoluto (com offset), portanto o resultado independe
 *   do fuso do navegador ou do servidor.
 * - Hidratação: servidor e primeira renderização do cliente mostram o mesmo
 *   placeholder ("--"); só depois da montagem `now` recebe o horário real.
 */
export function Countdown({ targetISO }: CountdownProps) {
  const [now, setNow] = useState<number | null>(null);
  const target = Date.parse(targetISO);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const parts = now === null ? null : splitDuration(target - now);
  const pad = (value: number) => String(value).padStart(2, "0");

  const units: Array<[string, string]> = [
    ["Dias", parts ? String(parts.days) : "--"],
    ["Horas", parts ? pad(parts.hours) : "--"],
    ["Minutos", parts ? pad(parts.minutes) : "--"],
    ["Segundos", parts ? pad(parts.seconds) : "--"],
  ];

  return (
    <Section id="contagem" title="Falta pouco">
      {now !== null && now >= target ? (
        <p role="status" className="text-center font-serif text-2xl italic leading-snug text-stone">
          {now - target < EVENT_WINDOW
            ? "A celebração já começou. Que Deus abençoe esse momento!"
            : "Obrigado por celebrar conosco. Que Deus abençoe a todos!"}
        </p>
      ) : (
        <div>
          <dl
            className="grid grid-cols-4 gap-2 text-center sm:gap-4"
            aria-label="Tempo restante até a celebração"
          >
            {units.map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-sand-deep/70 bg-paper/80 px-1 py-5 sm:py-7">
                <dd className="font-serif text-4xl font-medium tabular-nums text-ink sm:text-5xl">{value}</dd>
                <dt className="mt-1 text-[0.68rem] font-medium uppercase tracking-[0.18em] text-taupe-deep sm:text-xs">
                  {label}
                </dt>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Section>
  );
}
