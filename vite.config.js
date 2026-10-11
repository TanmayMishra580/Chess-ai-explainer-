
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "copy-stockfish-assets",
      closeBundle() {
        const source = resolve("node_modules/stockfish/bin");
        const target = resolve("dist/stockfish");
        mkdirSync(target, { recursive: true });
        cpSync(source, target, { recursive: true });
      }
    }
  ]
});
