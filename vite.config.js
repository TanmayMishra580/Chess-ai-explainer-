
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, mkdirSync } from "node:fs";
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

        for (const file of [
          "stockfish-19-lite-single.js",
          "stockfish-19-lite-single.wasm"
        ]) {
          copyFileSync(resolve(source, file), resolve(target, file));
        }
      }
    }
  ]
});
