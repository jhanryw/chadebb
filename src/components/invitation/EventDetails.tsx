import { CalendarDays, Clock, Coffee, MapPin, Shirt } from "lucide-react";
import type { ReactNode } from "react";
import { EVENT_CONTENT, type PublicEventConfig } from "@/lib/event-config";
import { Section } from "@/components/ui/Section";

function InfoCard({
  icon,
  label,
  children,
  className = "",
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <li className={`flex gap-4 rounded-2xl border border-sand-deep/70 bg-paper/80 p-5 ${className}`}>
      <span aria-hidden="true" className="mt-1 text-taupe-deep">
        {icon}
      </span>
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-taupe-deep">{label}</p>
        <div className="mt-1 text-lg leading-snug text-ink">{children}</div>
      </div>
    </li>
  );
}

export function EventDetails({ config }: { config: PublicEventConfig }) {
  return (
    <Section id="informacoes" title="Informações">
      <ul className="grid gap-4 sm:grid-cols-2">
        <InfoCard icon={<CalendarDays className="size-6" />} label="Data">
          <time dateTime={config.eventDateISO}>{config.longDateLabel}</time>
          <span className="block text-stone">{config.weekdayLabel}</span>
        </InfoCard>
        <InfoCard icon={<Clock className="size-6" />} label="Horário">
          Às {config.timeLabel}
        </InfoCard>
        <InfoCard icon={<MapPin className="size-6" />} label="Local" className="sm:col-span-2">
          {config.venueName}, {config.city}
          {config.address && <span className="mt-1 block text-base text-stone">{config.address}</span>}
        </InfoCard>
        <InfoCard icon={<Coffee className="size-6" />} label="Depois da celebração">
          <span className="text-base">{EVENT_CONTENT.afterCelebration}</span>
        </InfoCard>
        <InfoCard icon={<Shirt className="size-6" />} label="Traje sugerido">
          <span className="text-base">{EVENT_CONTENT.dressCode}</span>
        </InfoCard>
      </ul>
    </Section>
  );
}
