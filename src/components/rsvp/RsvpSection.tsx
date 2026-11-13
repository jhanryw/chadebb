import { CalendarX } from "lucide-react";
import type { PublicEventConfig } from "@/lib/event-config";
import { Section } from "@/components/ui/Section";
import { RsvpForm } from "./RsvpForm";

export function RsvpSection({ config }: { config: PublicEventConfig }) {
  return (
    <Section id="confirmar" title="Confirme sua presença">
      {config.rsvp.open ? (
        <>
          {config.rsvp.deadlineLabel && (
            <p className="mb-6 text-center text-stone">
              Responda até <strong className="font-medium text-ink">{config.rsvp.deadlineLabel}</strong>.
            </p>
          )}
          <RsvpForm limits={config.rsvp.limits} />
        </>
      ) : (
        <div
          role="status"
          className="rounded-3xl border border-sand-deep/70 bg-paper/80 px-6 py-10 text-center"
        >
          <CalendarX aria-hidden="true" className="mx-auto mb-4 size-8 text-taupe-deep" />
          <p className="font-serif text-2xl italic text-stone">
            O prazo para confirmação de presença já foi encerrado.
          </p>
        </div>
      )}
    </Section>
  );
}
