import { Countdown } from "@/components/countdown/Countdown";
import { EventDetails } from "@/components/invitation/EventDetails";
import { Hero } from "@/components/invitation/Hero";
import { InvitationMessage } from "@/components/invitation/InvitationMessage";
import { LocationSection } from "@/components/location/LocationSection";
import { RsvpSection } from "@/components/rsvp/RsvpSection";
import { Ornament } from "@/components/ui/Ornament";
import { getEventConfig, toPublicEventConfig, type PublicEventConfig } from "@/lib/event-config";
import { logEvent } from "@/lib/logger";

// Renderizada a cada requisição: lê as variáveis de ambiente em tempo de execução
// (sem depender de NEXT_PUBLIC_* embutidas no build) e permite CSP com nonce.
export const dynamic = "force-dynamic";

function loadConfig(): PublicEventConfig | null {
  try {
    return toPublicEventConfig(getEventConfig());
  } catch (error) {
    logEvent("page.error", {
      reason: "config",
      detail: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

export default function Home() {
  const config = loadConfig();

  if (!config) {
    return (
      <main id="conteudo" className="grid min-h-svh place-items-center px-6 text-center">
        <div>
          <Ornament className="mb-6" />
          <h1 className="font-script text-5xl text-ink">Luiza ou Augusto?</h1>
          <p className="mt-4 font-serif text-xl italic text-stone">
            Estamos ajustando alguns detalhes. Volte em instantes.
          </p>
        </div>
      </main>
    );
  }

  return (
    <>
      <Hero config={config} />
      <main id="conteudo">
        <InvitationMessage />
        <EventDetails config={config} />
        <Countdown targetISO={config.eventDateISO} />
        <LocationSection config={config} />
        <RsvpSection config={config} />
      </main>
      <footer className="px-6 pb-14 pt-6 text-center text-sm text-taupe-deep">
        <Ornament className="mb-4" />
        <p className="font-serif text-lg italic">Nossa Senhora das Graças, rogai por nós.</p>
      </footer>
    </>
  );
}
