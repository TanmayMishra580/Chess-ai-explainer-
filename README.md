# Chess Coach — Vercel-ready starter

A responsive chess analysis website built with React, Vite, `chess.js`, `react-chessboard`, and a browser Worker that attempts to load Stockfish from a CDN.

## Features
- Interactive chessboard with legal moves and queen promotion
- Stockfish candidate lines, evaluation, best-move arrow, and search-depth control
- Plain-English position overview and learning tips
- Move list, undo/navigation, FEN copy, FEN import, and PGN import
- Responsive dark UI

## Run locally
Requires Node.js 18+.

```bash
npm install
npm run dev
```

Open the local URL Vite prints.

## Deploy to Vercel
1. Create a GitHub repository and upload these files.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Framework preset: **Vite**. Build command: `npm run build`. Output directory: `dist`.
4. Deploy.

The included `vercel.json` handles SPA routing.

## Important Stockfish note
This starter loads a Stockfish JavaScript build from a CDN inside a Web Worker. CDN availability, cross-origin policies, and the exact Stockfish package build can change. If the engine shows **Engine offline**, replace the CDN worker loader in `src/App.jsx` with a pinned, tested Stockfish WASM build served from your own `/public` folder. For a production release, bundle a licensed Stockfish WASM/NNUE distribution locally and verify its asset paths and license notices.

## Current coaching scope
The app provides engine evaluation and principal variations, plus rule-based position commentary. It does **not** yet provide a reliable per-move accuracy report for a complete game. To grade every move, analyse the position before and after each move, compare evaluations from the mover's perspective, and label centipawn loss. More natural explanations of tactics/plans can be added using a separate LLM API, but that requires an API key and server-side endpoint; do not expose secret keys in browser code.

## Privacy
This starter does not save games to a server. Positions are held in browser memory. Stockfish code is fetched from the configured CDN.
