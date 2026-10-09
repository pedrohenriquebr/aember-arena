import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readBuildId } from "./buildId";

const respond = (body: string) => ({ text: async () => body }) as Response;

describe("H-19 readBuildId (UX_REWRITE_PLAN §5 H-19)", () => {
  it("lê o BUILD_ID do sw.js servido", async () => {
    const fetcher = async () => respond('self.BUILD_ID = "abc123-202610091200";');
    expect(await readBuildId(fetcher)).toBe("abc123-202610091200");
  });

  it("dev sem build (placeholder), em resposta sem o padrão e offline", async () => {
    expect(await readBuildId(async () => respond('self.BUILD_ID = "__BUILD_ID__";'))).toBe("dev");
    expect(await readBuildId(async () => respond("sem o padrao"))).toBe("dev");
    expect(await readBuildId(async () => { throw new Error("offline"); })).toBe("dev");
  });

  it("o sw.js real mantém o formato que o parser espera", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
    const source = readFileSync(join(root, "public", "sw.js"), "utf8");
    expect(source).toMatch(/self\.BUILD_ID = "[^"]+"/);
  });
});
