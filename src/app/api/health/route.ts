import { NextResponse } from "next/server";
import { getEventConfig } from "@/lib/event-config";
import { isServerConfigured } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness/readiness básicos. Não expõe segredos nem valores de configuração:
 * apenas se a configuração obrigatória está completa.
 */
export function GET(): NextResponse {
  let eventConfigured = true;
  try {
    getEventConfig();
  } catch {
    eventConfigured = false;
  }
  const configured = eventConfigured && isServerConfigured();

  return NextResponse.json(
    { status: "ok", configured },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
