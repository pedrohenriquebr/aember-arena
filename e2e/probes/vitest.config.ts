// Runs only the audit probes (e2e/probes/*.probe.ts); `npm test` never picks them up.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["e2e/probes/**/*.probe.ts"] },
});
