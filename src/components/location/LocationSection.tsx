import { Navigation } from "lucide-react";
import type { PublicEventConfig } from "@/lib/event-config";
import { Section } from "@/components/ui/Section";
import { buttonStyles } from "@/components/ui/button-styles";

export function LocationSection({ config }: { config: PublicEventConfig }) {
  return (
    <Section id="local" title="Localização">
      <div className="text-center">
        <p className="font-serif text-2xl text-ink">{config.venueName}</p>
        <p className="text-stone">{config.address ?? config.city}</p>
      </div>

      <div className="relative mt-8 aspect-[4/3] overflow-hidden rounded-3xl border border-sand-deep/70 bg-sand sm:aspect-[16/10]">
        {/* Fica por baixo do iframe: só aparece se o mapa não carregar. */}
        <p className="absolute inset-0 grid place-items-center p-6 text-center text-stone">
          O mapa não está disponível no momento. Use o botão “Como chegar” abaixo.
        </p>
        <iframe
          title={`Mapa: ${config.venueName}, ${config.city}`}
          src={config.mapEmbedUrl}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full border-0"
          allowFullScreen
        />
      </div>

      <div className="mt-8 text-center">
        <a
          href={config.mapUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonStyles.secondary}
        >
          <Navigation aria-hidden="true" className="size-5" />
          Como chegar
          <span className="visually-hidden"> (abre em uma nova aba)</span>
        </a>
      </div>
    </Section>
  );
}
