import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Emulador do workflow n8n para testes.
 *
 * Executa o MESMO código JavaScript embutido em n8n/chatbb-workflow.json (nós
 * Code), na mesma ordem do fluxo, contra uma "planilha" em memória. Só os nós
 * Webhook / IF / Google Sheets / Respond são simulados.
 */

interface WorkflowNode {
  name: string;
  type: string;
  parameters: { jsCode?: string };
}

const workflowPath = path.resolve(__dirname, "../../n8n/chatbb-workflow.json");

export function loadWorkflow(): { nodes: WorkflowNode[] } {
  return JSON.parse(readFileSync(workflowPath, "utf8"));
}

export function getNodeCode(name: string): string {
  const node = loadWorkflow().nodes.find((candidate) => candidate.name === name);
  if (!node?.parameters.jsCode) throw new Error(`Nó Code não encontrado: ${name}`);
  return node.parameters.jsCode;
}

type Json = Record<string, unknown>;

/** Executa o corpo de um nó Code com os globais do n8n simulados. */
export function runCodeNode(
  name: string,
  input: Json[],
  outputs: Record<string, Json> = {},
): Json[] {
  const code = getNodeCode(name);
  const $input = {
    first: () => ({ json: input[0] ?? {} }),
    all: () => input.map((json) => ({ json })),
  };
  const $ = (nodeName: string) => ({
    first: () => ({ json: outputs[nodeName] ?? {} }),
  });
  const fn = new Function("$input", "$", `return (function () {\n${code}\n})();`);
  const result = fn($input, $) as Array<{ json: Json }>;
  return result.map((item) => item.json);
}

export interface FakeN8nOptions {
  secret?: string;
  secretHeader?: string;
  /** Pausa assíncrona entre a leitura e a gravação (simula latência do Sheets). */
  ioDelay?: () => Promise<void>;
  failRead?: boolean;
  failAppend?: boolean;
}

export interface FakeN8nCall {
  status: number;
  body: unknown;
}

export class FakeN8n {
  readonly sheet: Json[] = [];
  readonly calls: FakeN8nCall[] = [];
  concurrent = 0;
  maxConcurrent = 0;

  constructor(private readonly options: FakeN8nOptions = {}) {}

  private async execute(payload: unknown): Promise<FakeN8nCall> {
    const validated = runCodeNode("Validar e normalizar", [{ body: payload as Json }])[0]!;
    if (validated.valid !== true) {
      return { status: validated.status as number, body: validated.response };
    }

    // Nó "Ler confirmações"
    await this.options.ioDelay?.();
    if (this.options.failRead) return { status: 503, body: { ok: false, code: "SERVICE_UNAVAILABLE" } };
    const snapshot = this.sheet.map((row) => ({ ...row }));
    const decision = runCodeNode("Decidir", snapshot.length ? snapshot : [{}], {
      "Validar e normalizar": validated,
    })[0]!;
    if (decision.action !== "write") {
      return { status: decision.status as number, body: decision.response };
    }

    // Nó "Gravar confirmação"
    await this.options.ioDelay?.();
    if (this.options.failAppend) return { status: 503, body: { ok: false, code: "SERVICE_UNAVAILABLE" } };
    this.sheet.push({ ...(decision.row as Json) });
    const created = runCodeNode("Resposta 201", [{}], { Decidir: decision })[0]!;
    return { status: created.status as number, body: created.response };
  }

  /** Substituto de `fetch` que fala com o "n8n" simulado. */
  fetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const header = this.options.secretHeader ?? "X-ChatBB-Secret";
    if (this.options.secret !== undefined && headers.get(header) !== this.options.secret) {
      this.calls.push({ status: 403, body: "Authorization data is wrong!" });
      return new Response("Authorization data is wrong!", { status: 403 });
    }
    this.concurrent += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent);
    try {
      const result = await this.execute(JSON.parse(String(init?.body ?? "null")));
      this.calls.push(result);
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { "content-type": "application/json" },
      });
    } finally {
      this.concurrent -= 1;
    }
  };
}
