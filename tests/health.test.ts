import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("responde 200 e não expõe segredos nem valores de configuração", async () => {
    vi.stubEnv("N8N_WEBHOOK_URL", "https://n8n.example.com/webhook/x");
    vi.stubEnv("N8N_WEBHOOK_SECRET", "segredo-de-teste-com-mais-de-16-chars");
    const response = GET();
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ status: "ok", configured: true });
    expect(text).not.toContain("segredo");
    expect(text).not.toContain("n8n.example.com");
  });

  it("sinaliza configuração incompleta sem detalhar o que falta", async () => {
    vi.stubEnv("N8N_WEBHOOK_URL", "");
    vi.stubEnv("N8N_WEBHOOK_SECRET", "");
    const body = await GET().json();
    expect(body).toEqual({ status: "ok", configured: false });
  });
});
