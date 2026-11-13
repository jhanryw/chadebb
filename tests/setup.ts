import { afterEach } from "vitest";

afterEach(async () => {
  // Limpa estado global entre testes (limitadores e fila de envio).
  const { resetLimiters } = await import("@/lib/security");
  const { resetQueue } = await import("@/lib/n8n");
  resetLimiters();
  resetQueue();
});
