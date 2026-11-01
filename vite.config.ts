import path from "path";
import { fileURLToPath } from "url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  // Publicado em subpath (github.io/keyforge-online/): relativo é o default seguro
  // do singlefile, e manifest/sw.js já resolvem a partir de "./".
  base: "./",
  plugins: [react(), viteSingleFile()],
  server: {
    // Acesso remoto (tuneis ngrok/trycloudflare/host-local da rede). O dono
    // joga de fora: libera qualquer host (o app nao tem servidor-state).
    allowedHosts: true,
  },
  preview: {
    allowedHosts: true,
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
