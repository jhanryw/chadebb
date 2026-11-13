"use client";

import { CircleCheck, Heart, LoaderCircle, ShieldCheck, CalendarX } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { EVENT_CONTENT, type RsvpLimits } from "@/lib/event-config";
import { newIdempotencyKey, submitRsvp } from "@/lib/rsvp-client";
import { NAME_MAX_LENGTH, buildRsvpSchema, toFieldErrors, type FieldErrors } from "@/lib/validations";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { buttonStyles } from "@/components/ui/button-styles";

type Presenca = "SIM" | "NAO";
type Phase =
  | { name: "editing" }
  | { name: "submitting" }
  | { name: "success"; presenca: Presenca }
  | { name: "closed" };

export function RsvpForm({ limits }: { limits: RsvpLimits }) {
  const schema = useMemo(() => buildRsvpSchema(limits), [limits]);
  const uid = useId();
  const ids = {
    nome: `${uid}-nome`,
    nomeError: `${uid}-nome-erro`,
    presenca: `${uid}-presenca`,
    presencaError: `${uid}-presenca-erro`,
  };

  const minAdults = limits.allowChildHolder ? 0 : 1;
  const [nome, setNome] = useState("");
  const [presenca, setPresenca] = useState<Presenca | null>(null);
  const [adultos, setAdultos] = useState(1);
  const [criancas, setCriancas] = useState(0);
  const [honeypot, setHoneypot] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "editing" });

  // Mesma chave enquanto o conteúdo enviado for o mesmo: reenvios após falha de rede são idempotentes.
  const attemptRef = useRef<{ signature: string; key: string } | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const submitting = phase.name === "submitting";
  const total = presenca === "SIM" ? adultos + criancas : 0;

  useEffect(() => {
    if (phase.name === "success" || phase.name === "closed") resultRef.current?.focus();
  }, [phase.name]);

  function focusFirstError(found: FieldErrors) {
    const target = found.nome
      ? ids.nome
      : found.presenca
        ? `${ids.presenca}-sim`
        : null;
    if (target) document.getElementById(target)?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setFormError(null);
    const candidate = {
      nome,
      presenca: presenca ?? undefined,
      adultos: presenca === "SIM" ? adultos : 0,
      criancas: presenca === "SIM" ? criancas : 0,
      website: honeypot,
    };
    const parsed = schema.safeParse(candidate);
    if (!parsed.success) {
      const found = toFieldErrors(parsed.error);
      setErrors(found);
      focusFirstError(found);
      return;
    }
    setErrors({});

    const request = {
      nome: parsed.data.nome,
      presenca: parsed.data.presenca,
      adultos: parsed.data.adultos,
      criancas: parsed.data.criancas,
      website: parsed.data.honeypot,
    };
    const signature = JSON.stringify(request);
    if (attemptRef.current?.signature !== signature) {
      attemptRef.current = { signature, key: newIdempotencyKey() };
    }

    setPhase({ name: "submitting" });
    const result = await submitRsvp(request, attemptRef.current.key);

    switch (result.kind) {
      case "success":
        setPhase({ name: "success", presenca: result.presenca });
        return;
      case "closed":
        setPhase({ name: "closed" });
        return;
      case "field-errors":
        setErrors(result.fieldErrors);
        setFormError(result.message);
        focusFirstError(result.fieldErrors);
        break;
      case "error":
        setFormError(result.message);
        break;
    }
    setPhase({ name: "editing" });
  }

  if (phase.name === "success") {
    const attending = phase.presenca === "SIM";
    return (
      <div
        ref={resultRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className="rounded-3xl border border-sand-deep/70 bg-paper/80 px-6 py-12 text-center outline-none"
      >
        {attending ? (
          <CircleCheck aria-hidden="true" className="mx-auto mb-4 size-10 text-taupe-deep" />
        ) : (
          <Heart aria-hidden="true" className="mx-auto mb-4 size-10 text-taupe-deep" />
        )}
        <h3 className="font-script text-4xl text-ink">
          {attending ? "Presença confirmada" : "Obrigado pela resposta"}
        </h3>
        <p className="mx-auto mt-4 max-w-md font-serif text-2xl italic leading-snug text-stone">
          {attending ? EVENT_CONTENT.successAttending : EVENT_CONTENT.successNotAttending}
        </p>
      </div>
    );
  }

  if (phase.name === "closed") {
    return (
      <div
        ref={resultRef}
        tabIndex={-1}
        role="status"
        className="rounded-3xl border border-sand-deep/70 bg-paper/80 px-6 py-10 text-center outline-none"
      >
        <CalendarX aria-hidden="true" className="mx-auto mb-4 size-8 text-taupe-deep" />
        <p className="font-serif text-2xl italic text-stone">
          O prazo para confirmação de presença já foi encerrado.
        </p>
      </div>
    );
  }

  const inputClass =
    "mt-2 block min-h-12 w-full rounded-xl border bg-paper px-4 text-lg text-ink placeholder:text-stone/60 disabled:opacity-60";

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-busy={submitting}
      className="space-y-8 rounded-3xl border border-sand-deep/70 bg-paper/80 px-5 py-8 sm:px-10"
    >
      {/* Nome */}
      <div>
        <label htmlFor={ids.nome} className="block text-base font-medium text-ink">
          Nome completo
        </label>
        <input
          id={ids.nome}
          name="nome"
          type="text"
          autoComplete="name"
          maxLength={NAME_MAX_LENGTH + 20}
          value={nome}
          disabled={submitting}
          onChange={(event) => setNome(event.target.value)}
          aria-required="true"
          aria-invalid={errors.nome ? true : undefined}
          aria-describedby={errors.nome ? ids.nomeError : undefined}
          placeholder="Nome e sobrenome"
          className={`${inputClass} ${errors.nome ? "border-error" : "border-taupe-deep/50"}`}
        />
        {errors.nome && (
          <p id={ids.nomeError} className="mt-2 text-sm font-medium text-error">
            {errors.nome}
          </p>
        )}
      </div>

      {/* Presença */}
      <fieldset
        disabled={submitting}
        aria-describedby={errors.presenca ? ids.presencaError : undefined}
        className="min-w-0"
      >
        <legend className="text-base font-medium text-ink">Você estará presente?</legend>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {(
            [
              ["SIM", "Vou", "sim"],
              ["NAO", "Não vou", "nao"],
            ] as const
          ).map(([value, label, suffix]) => (
            <div key={value}>
              <input
                id={`${ids.presenca}-${suffix}`}
                type="radio"
                name="presenca"
                value={value}
                checked={presenca === value}
                onChange={() => {
                  setPresenca(value);
                  setErrors((current) => ({ ...current, presenca: undefined }));
                }}
                className="peer sr-only"
              />
              <label
                htmlFor={`${ids.presenca}-${suffix}`}
                className="grid min-h-14 cursor-pointer place-items-center rounded-xl border border-taupe-deep/50 bg-paper px-4 text-lg text-ink transition-colors hover:bg-sand peer-checked:border-ink peer-checked:bg-ink peer-checked:text-ivory peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-taupe-deep"
              >
                {label}
              </label>
            </div>
          ))}
        </div>
        {errors.presenca && (
          <p id={ids.presencaError} className="mt-2 text-sm font-medium text-error">
            {errors.presenca}
          </p>
        )}
      </fieldset>

      {/* Quantidades (somente para "Vou") */}
      {presenca === "SIM" && (
        <div className="space-y-6 rounded-2xl bg-sand/60 p-5">
          <NumberStepper
            label="Quantos adultos estarão presentes?"
            hint={
              limits.allowChildHolder
                ? "Inclua você, se for adulto."
                : "Inclua você na contagem (mínimo 1)."
            }
            value={adultos}
            min={minAdults}
            max={limits.maxAdults}
            onChange={setAdultos}
            error={errors.adultos}
            disabled={submitting}
          />
          <NumberStepper
            label="Quantas crianças estarão presentes?"
            hint={
              limits.allowChildHolder
                ? "Se a resposta for em nome de uma criança, informe 0 adultos e inclua a criança aqui."
                : "Se você for responsável por crianças, inclua-as aqui (não conte as crianças como adultos)."
            }
            value={criancas}
            min={0}
            max={limits.maxChildren}
            onChange={setCriancas}
            error={errors.criancas}
            disabled={submitting}
          />
          <p className="text-center text-base text-stone" aria-live="polite">
            Total de pessoas: <strong className="font-medium text-ink">{total}</strong>
          </p>
        </div>
      )}

      {/* Armadilha para robôs: invisível e fora da navegação por teclado. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Não preencha este campo
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(event) => setHoneypot(event.target.value)}
          />
        </label>
      </div>

      {formError && (
        <div role="alert" className="rounded-xl border border-error/40 bg-error/5 px-4 py-3 text-base text-error">
          {formError}
        </div>
      )}

      <button type="submit" disabled={submitting} className={`${buttonStyles.primary} w-full`}>
        {submitting ? (
          <>
            <LoaderCircle aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" />
            Enviando…
          </>
        ) : (
          "Enviar confirmação"
        )}
      </button>

      <div className="flex gap-3 text-sm leading-relaxed text-stone">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-taupe-deep" />
        <p>
          Usamos seu nome e as quantidades informadas apenas para organizar o evento. Não publicamos
          essas informações nem as usamos para outros fins. Este link é aberto e o nome é livre, por
          isso pedimos que cada pessoa ou família responda uma única vez. Depois de enviada, a resposta
          não pode ser alterada pelo site — se precisar corrigir algo, fale diretamente com os
          anfitriões.
        </p>
      </div>
    </form>
  );
}
