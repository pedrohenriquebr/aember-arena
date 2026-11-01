// O corpus do harvest (scripts/harvest/*.json) é dado local: fica fora do
// repositório público por tamanho e por conter texto de carta. As bancadas que
// dependem dele carregam por aqui e se pulam quando o arquivo não existe, para
// `npm test` num clone limpo continuar verde.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function harvestJson<T>(name: string): T | undefined {
  const file = join(process.cwd(), "scripts", "harvest", name);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as T;
}
