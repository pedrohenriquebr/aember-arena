import path from "path";
import { fileURLToPath } from "url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  server: {
    // Acesso remoto via tunel (trycloudflare muda de subdominio a cada run).
    allowedHosts: [".trycloudflare.com"],
  },
  preview: {
    allowedHosts: [".trycloudflare.com"],
  },
  build: {
    // Orcamento de bundle (CLAUDE.md §7): o app e um chunk unico inlined, entao
    // o polyfill/links de modulepreload nunca tem efeito — remove-los e folga real.
    modulePreload: false,
    minify: "terser",
    terserOptions: { compress: { passes: 3, drop_console: ["log"], toplevel: true }, mangle: { toplevel: true } },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
