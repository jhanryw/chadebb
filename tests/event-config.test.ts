import { describe, expect, it } from "vitest";
import {
  ConfigError,
  formatEventDate,
  formatEventTime,
  isRsvpOpen,
  parseEventConfig,
  toPublicEventConfig,
} from "@/lib/event-config";
import { parseServerConfig } from "@/lib/server-config";

describe("parseEventConfig", () => {
  it("usa os valores do evento por padrão e define o prazo como o início quando não configurado", () => {
    const config = parseEventConfig({});
    expect(config.eventDateISO).toBe("2026-11-22T08:00:00-03:00");
    expect(config.timeZone).toBe("America/Fortaleza");
    expect(config.rsvpClosesAtISO).toBe(config.eventDateISO);
    expect(config.hasExplicitDeadline).toBe(false);
    expect(config.limits).toEqual({ maxAdults: 10, maxChildren: 10, allowChildHolder: false });
  });

  it("trata variáveis vazias como ausentes (como no .env.example)", () => {
    const config = parseEventConfig({ RSVP_DEADLINE: "", EVENT_ADDRESS: "  ", EVENT_MAP_URL: "" });
    expect(config.address).toBeNull();
    expect(config.hasExplicitDeadline).toBe(false);
  });

  it("não inventa endereço nem coordenadas: o mapa usa o endereço configurado ou o nome do local", () => {
    const fallback = parseEventConfig({});
    expect(fallback.mapUrl).toContain("query=" + encodeURIComponent("Capela do Colégio Nossa Senhora das Neves, Natal/RN"));
    expect(fallback.mapUrl).not.toMatch(/-?\d+\.\d{4,}/);
    const custom = parseEventConfig({ EVENT_ADDRESS: "Rua Exemplo, 123", EVENT_MAP_URL: "https://maps.app.goo.gl/abc" });
    expect(custom.mapUrl).toBe("https://maps.app.goo.gl/abc");
    expect(custom.mapEmbedUrl).toContain(encodeURIComponent("Rua Exemplo, 123"));
  });

  it("rejeita datas sem fuso, fusos inválidos e URLs não-https", () => {
    expect(() => parseEventConfig({ EVENT_DATE: "2026-11-22T08:00:00" })).toThrow(ConfigError);
    expect(() => parseEventConfig({ EVENT_DATE: "22/11/2026" })).toThrow(ConfigError);
    expect(() => parseEventConfig({ EVENT_TIMEZONE: "Marte/Olimpo" })).toThrow(ConfigError);
    expect(() => parseEventConfig({ EVENT_MAP_URL: "javascript:alert(1)" })).toThrow(ConfigError);
    expect(() => parseEventConfig({ EVENT_MAP_URL: "http://insecure.example" })).toThrow(ConfigError);
    expect(() => parseEventConfig({ RSVP_MAX_ADULTS: "-1" })).toThrow(ConfigError);
    expect(() => parseEventConfig({ RSVP_MAX_ADULTS: "1000" })).toThrow(ConfigError);
  });

  it("lê limites e a opção de titular criança", () => {
    const config = parseEventConfig({ RSVP_MAX_ADULTS: "4", RSVP_MAX_CHILDREN: "0", RSVP_ALLOW_CHILD_HOLDER: "true" });
    expect(config.limits).toEqual({ maxAdults: 4, maxChildren: 0, allowChildHolder: true });
  });
});

describe("prazo", () => {
  it("é independente do fuso do processo", () => {
    const config = parseEventConfig({ RSVP_DEADLINE: "2026-11-15T23:59:59-03:00" });
    expect(isRsvpOpen(config, new Date("2026-11-16T02:59:58Z"))).toBe(true);
    expect(isRsvpOpen(config, new Date("2026-11-16T02:59:59Z"))).toBe(false);
  });
});

describe("formatação no fuso do evento", () => {
  it("formata data e hora do evento em pt-BR", () => {
    expect(formatEventDate("2026-11-22T08:00:00-03:00", "America/Fortaleza")).toBe("22 de novembro de 2026, domingo");
    expect(formatEventTime("2026-11-22T08:00:00-03:00", "America/Fortaleza")).toBe("8h");
    expect(formatEventTime("2026-11-22T08:30:00-03:00", "America/Fortaleza")).toBe("8h30");
  });

  it("usa o fuso do evento mesmo quando o instante cruza a meia-noite em UTC", () => {
    expect(formatEventDate("2026-11-22T23:30:00-03:00", "America/Fortaleza")).toBe("22 de novembro de 2026, domingo");
  });

  it("monta o rótulo completo e o estado do prazo na visão pública", () => {
    const view = toPublicEventConfig(parseEventConfig({ RSVP_DEADLINE: "2026-11-15T23:59:59-03:00" }), new Date("2026-11-13T12:00:00Z"));
    expect(view.fullDateLabel).toBe("22 de novembro de 2026, domingo, às 8h");
    expect(view.rsvp).toMatchObject({ open: true, deadlineLabel: "15 de novembro de 2026" });
    expect(toPublicEventConfig(parseEventConfig({}), new Date("2026-11-30T12:00:00Z")).rsvp.open).toBe(false);
  });
});

describe("parseServerConfig", () => {
  const valid = { N8N_WEBHOOK_URL: "https://n8n.example.com/webhook/chatbb-rsvp", N8N_WEBHOOK_SECRET: "x".repeat(24) };

  it("aplica padrões seguros", () => {
    const config = parseServerConfig(valid);
    expect(config).toMatchObject({ n8nSecretHeader: "X-ChatBB-Secret", n8nTimeoutMs: 15000, rateLimitMax: 10, trustedProxyHops: 1 });
  });

  it("exige URL e segredo forte, sem vazar o valor do segredo na mensagem", () => {
    expect(() => parseServerConfig({})).toThrow(ConfigError);
    expect(() => parseServerConfig({ ...valid, N8N_WEBHOOK_URL: "ftp://x" })).toThrow(ConfigError);
    let message = "";
    try {
      parseServerConfig({ ...valid, N8N_WEBHOOK_SECRET: "curto-demais" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("N8N_WEBHOOK_SECRET");
    expect(message).not.toContain("curto-demais");
  });
});
