import { EVENT_CONTENT } from "@/lib/event-config";
import { Section } from "@/components/ui/Section";

export function InvitationMessage() {
  const [opening, ...rest] = EVENT_CONTENT.invitationParagraphs;
  return (
    <Section id="convite" title="Com fé e gratidão">
      <div className="rounded-3xl border border-sand-deep/70 bg-paper/80 px-6 py-10 text-center shadow-[0_1px_0_rgba(125,108,88,0.06)] sm:px-12">
        <p className="font-serif text-2xl italic leading-snug text-ink sm:text-[1.75rem]">{opening}</p>
        <div className="mt-6 space-y-5 font-serif text-xl leading-relaxed text-stone sm:text-[1.35rem]">
          {rest.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </div>
    </Section>
  );
}
