import { describe, expect, it } from "vitest";
import { FixedWindowLimiter, getClientIp, isAllowedOrigin, readBodyLimited } from "@/lib/security";

describe("FixedWindowLimiter", () => {
  it("permite até o máximo e bloqueia depois, reiniciando na nova janela", () => {
    const limiter = new FixedWindowLimiter(2, 10_000);
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("a", 100).allowed).toBe(true);
    const blocked = limiter.check("a", 200);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(10);
    expect(limiter.check("b", 200).allowed).toBe(true);
    expect(limiter.check("a", 10_001).allowed).toBe(true);
  });

  it("não cresce sem limite: poda chaves expiradas e falha fechado quando cheio", () => {
    const limiter = new FixedWindowLimiter(1, 1000, 3);
    for (const key of ["a", "b", "c"]) expect(limiter.check(key, 0).allowed).toBe(true);
    expect(limiter.check("d", 10).allowed).toBe(false); // cheio e nada expirou
    expect(limiter.check("d", 2000).allowed).toBe(true); // expiradas foram podadas
  });
});

describe("getClientIp", () => {
  const headers = (init: Record<string, string>) => new Headers(init);
  it("usa a entrada do proxy confiável (a partir do fim), ignorando valores forjados à esquerda", () => {
    expect(getClientIp(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.5" }), 1)).toBe("203.0.113.5");
    expect(getClientIp(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.5, 10.0.0.2" }), 2)).toBe("203.0.113.5");
    expect(getClientIp(headers({ "x-forwarded-for": "203.0.113.5" }), 1)).toBe("203.0.113.5");
  });
  it("cai para x-real-ip e depois para 'unknown'; com 0 proxies ignora cabeçalhos", () => {
    expect(getClientIp(headers({ "x-real-ip": "198.51.100.9" }), 1)).toBe("198.51.100.9");
    expect(getClientIp(headers({}), 1)).toBe("unknown");
    expect(getClientIp(headers({ "x-forwarded-for": "1.2.3.4" }), 0)).toBe("unknown");
  });
});

describe("isAllowedOrigin", () => {
  it("aceita sem Origin, mesma origem e SITE_URL; rejeita outros sites e Origin inválida", () => {
    expect(isAllowedOrigin(new Headers(), null)).toBe(true);
    expect(isAllowedOrigin(new Headers({ origin: "https://convite.example", host: "convite.example" }), null)).toBe(true);
    expect(isAllowedOrigin(new Headers({ origin: "https://convite.example", host: "10.0.0.5:3000" }), "https://convite.example")).toBe(true);
    expect(isAllowedOrigin(new Headers({ origin: "https://convite.example", "x-forwarded-host": "convite.example", host: "app:3000" }), null)).toBe(true);
    expect(isAllowedOrigin(new Headers({ origin: "https://evil.example", host: "convite.example" }), "https://convite.example")).toBe(false);
    expect(isAllowedOrigin(new Headers({ origin: "null", host: "convite.example" }), null)).toBe(false);
  });
});

describe("readBodyLimited", () => {
  const req = (body: string, headers: Record<string, string> = {}) => new Request("http://x/", { method: "POST", body, headers });
  it("lê corpos pequenos", async () => {
    expect(await readBodyLimited(req('{"a":"ção"}'), 100)).toEqual({ ok: true, text: '{"a":"ção"}' });
  });
  it("recusa por Content-Length e também quando o corpo real excede o limite", async () => {
    expect(await readBodyLimited(req("x".repeat(50), { "content-length": "50" }), 10)).toEqual({ ok: false, reason: "too_large" });
    expect(await readBodyLimited(req("x".repeat(50)), 10)).toEqual({ ok: false, reason: "too_large" });
  });
  it("rejeita UTF-8 inválido", async () => {
    const bad = new Request("http://x/", { method: "POST", body: new Uint8Array([0xff, 0xfe, 0xfd]) });
    expect(await readBodyLimited(bad, 10)).toEqual({ ok: false, reason: "unreadable" });
  });
});
