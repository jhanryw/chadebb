// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Countdown, splitDuration } from "@/components/countdown/Countdown";

const TARGET = "2026-11-22T08:00:00-03:00"; // = 11:00 UTC

beforeEach(() => vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("splitDuration", () => {
  it("divide a diferença em dias, horas, minutos e segundos", () => {
    const ms = ((9 * 24 + 3) * 3600 + 25 * 60 + 41) * 1000;
    expect(splitDuration(ms)).toEqual({ days: 9, hours: 3, minutes: 25, seconds: 41 });
    expect(splitDuration(-5000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });
});

describe("Countdown", () => {
  it("renderiza o mesmo HTML no servidor, independentemente do horário (sem divergência de hidratação)", () => {
    vi.setSystemTime(new Date("2026-11-13T13:50:07Z"));
    const first = renderToString(<Countdown targetISO={TARGET} />);
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const second = renderToString(<Countdown targetISO={TARGET} />);
    expect(first).toBe(second);
    expect(first).toContain("--");
  });

  it("depois de montar, mostra dias/horas/minutos/segundos e atualiza a cada segundo", () => {
    vi.setSystemTime(new Date("2026-11-13T13:50:07Z")); // 8d 21h 9m 53s antes
    render(<Countdown targetISO={TARGET} />);
    const text = () => screen.getByLabelText("Tempo restante até a celebração").textContent;
    expect(text()).toContain("8Dias");
    expect(text()).toContain("21Horas");
    expect(text()).toContain("09Minutos");
    expect(text()).toContain("53Segundos");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(text()).toContain("52Segundos");
  });

  it("o resultado depende só do instante absoluto, não do fuso do navegador", () => {
    const original = process.env.TZ;
    for (const tz of ["America/Fortaleza", "Asia/Tokyo", "UTC"]) {
      process.env.TZ = tz;
      vi.setSystemTime(new Date("2026-11-21T11:00:00Z")); // exatamente 1 dia antes
      const { unmount } = render(<Countdown targetISO={TARGET} />);
      expect(screen.getByLabelText("Tempo restante até a celebração").textContent).toContain("1Dias");
      unmount();
    }
    process.env.TZ = original;
  });

  it("após o início, troca a contagem por uma mensagem; depois de 12 h, por agradecimento", () => {
    vi.setSystemTime(new Date("2026-11-22T11:00:00Z"));
    const { unmount } = render(<Countdown targetISO={TARGET} />);
    expect(screen.getByRole("status")).toHaveTextContent("A celebração já começou");
    expect(screen.queryByLabelText("Tempo restante até a celebração")).not.toBeInTheDocument();
    unmount();

    vi.setSystemTime(new Date("2026-11-23T11:00:00Z"));
    render(<Countdown targetISO={TARGET} />);
    expect(screen.getByRole("status")).toHaveTextContent("Obrigado por celebrar conosco");
  });
});
