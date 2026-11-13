/**
 * Log técnico estruturado (uma linha JSON por evento).
 *
 * Regra: NUNCA registrar nome, IP, segredos, URL do webhook ou o corpo da
 * requisição. Apenas identificadores técnicos (requestId), códigos e tempos.
 */
export function logEvent(
  event: string,
  fields: Record<string, string | number | boolean | null | undefined> = {},
): void {
  const line = JSON.stringify({ t: new Date().toISOString(), event, ...fields });
  if (event.endsWith(".error") || event.endsWith(".warn")) {
    console.error(line);
  } else {
    console.log(line);
  }
}
