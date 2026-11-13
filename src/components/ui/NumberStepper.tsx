"use client";

import { Minus, Plus } from "lucide-react";
import { useId } from "react";

interface NumberStepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  hint?: string;
  error?: string | undefined;
  disabled?: boolean;
}

/** Campo numérico inteiro com botões grandes (confortável para toque). */
export function NumberStepper({
  label,
  value,
  min,
  max,
  onChange,
  hint,
  error,
  disabled = false,
}: NumberStepperProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const buttonClass =
    "grid size-12 shrink-0 place-items-center rounded-full border border-taupe-deep/50 bg-paper text-ink transition-colors hover:bg-sand disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div>
      <label htmlFor={id} className="block text-base font-medium text-ink">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mt-0.5 text-sm text-stone">
          {hint}
        </p>
      )}
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          className={buttonClass}
          aria-label={`Diminuir: ${label}`}
          disabled={disabled || value <= min}
          onClick={() => onChange(clamp(value - 1))}
        >
          <Minus aria-hidden="true" className="size-5" />
        </button>
        <input
          id={id}
          name={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          value={String(value)}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, "").slice(0, 3);
            onChange(clamp(digits === "" ? min : Number(digits)));
          }}
          onFocus={(event) => event.target.select()}
          className="h-12 w-20 rounded-xl border border-taupe-deep/50 bg-paper text-center text-xl tabular-nums text-ink"
        />
        <button
          type="button"
          className={buttonClass}
          aria-label={`Aumentar: ${label}`}
          disabled={disabled || value >= max}
          onClick={() => onChange(clamp(value + 1))}
        >
          <Plus aria-hidden="true" className="size-5" />
        </button>
      </div>
      {error && (
        <p id={errorId} className="mt-2 text-sm font-medium text-error">
          {error}
        </p>
      )}
    </div>
  );
}
