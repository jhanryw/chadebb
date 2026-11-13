// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RsvpForm } from "@/components/rsvp/RsvpForm";

afterEach(() => cleanup());

const limits = { maxAdults: 10, maxChildren: 10, allowChildHolder: false };

function mockFetch(...responses: Array<Response | Error | (() => Promise<Response>)>) {
  const queue = [...responses];
  const fn = vi.fn(async () => {
    const next = queue.shift();
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next();
    return next ?? new Response("{}", { status: 500 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const ok = (presenca: "SIM" | "NAO", status = 201) =>
  new Response(JSON.stringify({ ok: true, code: status === 201 ? "CREATED" : "ALREADY_RECORDED", presenca }), { status });
const fail = (status: number, code: string, message: string, extra: object = {}) =>
  new Response(JSON.stringify({ ok: false, code, message, ...extra }), { status });

async function fillName(user: ReturnType<typeof userEvent.setup>, name = "Maria da Silva") {
  await user.type(screen.getByLabelText("Nome completo"), name);
}

describe("RsvpForm", () => {
  it("só mostra as quantidades quando a pessoa escolhe 'Vou' e já inclui o titular (1 adulto)", async () => {
    const user = userEvent.setup();
    render(<RsvpForm limits={limits} />);
    expect(screen.queryByLabelText(/Quantos adultos/)).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Vou"));
    expect(screen.getByRole("textbox", { name: /Quantos adultos/ })).toHaveValue("1");
    expect(screen.getByRole("textbox", { name: /Quantas crianças/ })).toHaveValue("0");
    expect(screen.getByText(/Total de pessoas/)).toHaveTextContent("Total de pessoas: 1");

    await user.click(screen.getByLabelText("Não vou"));
    expect(screen.queryByLabelText(/Quantos adultos/)).not.toBeInTheDocument();
  });

  it("mostra erros abaixo dos campos, associados por aria, e não envia nada", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch();
    render(<RsvpForm limits={limits} />);
    await user.click(screen.getByRole("button", { name: "Enviar confirmação" }));

    const nome = screen.getByLabelText("Nome completo");
    expect(nome).toHaveAttribute("aria-invalid", "true");
    expect(nome).toHaveAccessibleDescription(/nome completo/i);
    expect(nome).toHaveFocus();
    expect(screen.getByText("Informe se você estará presente.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirmação positiva: botão fica desabilitado com 'Enviando…' e o sucesso só aparece depois da resposta do backend", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const fetchMock = mockFetch(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(ok("SIM"));
        }),
    );
    render(<RsvpForm limits={limits} />);
    await fillName(user);
    await user.click(screen.getByLabelText("Vou"));
    await user.click(screen.getByLabelText("Aumentar: Quantas crianças estarão presentes?"));
    await user.click(screen.getByRole("button", { name: "Enviar confirmação" }));

    const sending = await screen.findByRole("button", { name: /Enviando/ });
    expect(sending).toBeDisabled();
    expect(screen.queryByText(/Presença confirmada/)).not.toBeInTheDocument();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/rsvp");
    expect(JSON.parse(String(init.body))).toMatchObject({ nome: "Maria da Silva", presenca: "SIM", adultos: 1, criancas: 1 });
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^[0-9a-f-]{32,36}$/);

    release();
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Que alegria! Sua presença foi confirmada. Esperamos você para compartilhar esse momento tão especial.");
    expect(status).toHaveFocus();
  });

  it("confirmação negativa: envia 0/0 e mostra a mensagem de ausência", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(ok("NAO"));
    render(<RsvpForm limits={limits} />);
    await fillName(user, "Carlos Souza");
    await user.click(screen.getByLabelText("Não vou"));
    await user.click(screen.getByRole("button", { name: "Enviar confirmação" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Sentiremos sua falta, mas agradecemos por nos responder e pelo carinho.");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ presenca: "NAO", adultos: 0, criancas: 0 });
  });

  it("erro do servidor não declara sucesso; o reenvio reutiliza a MESMA chave de idempotência", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(fail(503, "SERVICE_UNAVAILABLE", "Não foi possível registrar sua resposta agora."), ok("SIM"));
    render(<RsvpForm limits={limits} />);
    await fillName(user);
    await user.click(screen.getByLabelText("Vou"));
    await user.click(screen.getByRole("button", { name: "Enviar confirmação" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível registrar sua resposta agora.");
    expect(screen.queryByText(/Presença confirmada/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar confirmação" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Enviar confirmação" }));
    await screen.findByText(/Presença confirmada/);
    const keys = fetchMock.mock.calls.map((call) => ((call as unknown as [string, RequestInit])[1].headers as Record<string, string>)["Idempotency-Key"]);
    expect(keys[0]).toBe(keys[1]);
  });

  it("falha de rede mostra mensagem acolhedora e permite tentar de novo", async () => {
    const user = userEvent.setup();
    mockFetch(new TypeError("Failed to fetch"));
    render(<RsvpForm limits={limits} />);
    await fillName(user);
    await user.click(screen.getByLabelText("Não vou"));
    await user.click(screen.getByRole("button", { name: "Enviar confirmação" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/conectar/);
    expect(screen.getByRole("button", { name: "Enviar confirmação" })).toBeEnabled();
  });

  it("nome duplicado (409): mensagem genérica, sem sucesso", async () => {
    const user = userEvent.setup();
    mockFetch(fail(409, "DUPLICATE_NAME", "Não foi possível registrar esta confirmação. Se você já respondeu, não é necessário enviar novamente."));
    render(<RsvpForm limits={limits} />);
    await fillName(user);
    await user.click(screen.getByLabelText("Vou"));
    await user.click(screen.getByRole("button", { name: "Enviar confirmação" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/já respondeu/);
    expect(screen.queryByText(/Presença confirmada/)).not.toBeInTheDocument();
  });

  it("prazo encerrado no servidor (403): troca o formulário pela mensagem de encerramento", async () => {
    const user = userEvent.setup();
    mockFetch(fail(403, "RSVP_CLOSED", "O prazo para confirmação de presença já foi encerrado."));
    render(<RsvpForm limits={limits} />);
    await fillName(user);
    await user.click(screen.getByLabelText("Não vou"));
    await user.click(screen.getByRole("button", { name: "Enviar confirmação" }));
    expect(await screen.findByText("O prazo para confirmação de presença já foi encerrado.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enviar confirmação" })).not.toBeInTheDocument();
  });

  it("422 do servidor mostra os erros por campo", async () => {
    const user = userEvent.setup();
    mockFetch(fail(422, "INVALID_DATA", "Verifique os campos destacados.", { fieldErrors: { nome: "Informe nome e sobrenome." } }));
    render(<RsvpForm limits={limits} />);
    await fillName(user);
    await user.click(screen.getByLabelText("Não vou"));
    await user.click(screen.getByRole("button", { name: "Enviar confirmação" }));
    await waitFor(() => expect(screen.getByLabelText("Nome completo")).toHaveAccessibleDescription("Informe nome e sobrenome."));
  });

  it("respeita os limites dos botões + e −", async () => {
    const user = userEvent.setup();
    render(<RsvpForm limits={{ maxAdults: 2, maxChildren: 1, allowChildHolder: false }} />);
    await user.click(screen.getByLabelText("Vou"));
    const minus = screen.getByLabelText("Diminuir: Quantos adultos estarão presentes?");
    const plus = screen.getByLabelText("Aumentar: Quantos adultos estarão presentes?");
    expect(minus).toBeDisabled(); // mínimo 1 (o titular)
    await user.click(plus);
    expect(plus).toBeDisabled(); // máximo 2
    expect(screen.getByRole("textbox", { name: /Quantos adultos/ })).toHaveValue("2");
  });

  it("titular criança (opção): permite 0 adultos sem exigir adulto fictício", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(ok("SIM"));
    render(<RsvpForm limits={{ ...limits, allowChildHolder: true }} />);
    await fillName(user, "Pedro Henrique Lima");
    await user.click(screen.getByLabelText("Vou"));
    await user.click(screen.getByLabelText("Diminuir: Quantos adultos estarão presentes?"));
    await user.click(screen.getByLabelText("Aumentar: Quantas crianças estarão presentes?"));
    await user.click(screen.getByRole("button", { name: "Enviar confirmação" }));
    await screen.findByText(/Presença confirmada/);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ adultos: 0, criancas: 1 });
  });

  it("explica a privacidade e que a resposta não pode ser editada", () => {
    render(<RsvpForm limits={limits} />);
    const form = screen.getByRole("button", { name: "Enviar confirmação" }).closest("form")!;
    expect(within(form).getByText(/apenas para organizar o evento/)).toBeInTheDocument();
    expect(within(form).getByText(/não pode ser alterada pelo site/)).toBeInTheDocument();
  });
});
