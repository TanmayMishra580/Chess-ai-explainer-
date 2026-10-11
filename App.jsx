import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import {
  Activity, ArrowLeft, ArrowRight, Brain, Check, ChevronDown, CircleHelp,
  Clipboard, Cpu, Flag, Gauge, Lightbulb, RotateCcw, Sparkles, Target,
  TrendingDown, TrendingUp, Undo2, Zap
} from "lucide-react";

const START_FEN = "start";
const STOCKFISH_URLS = [
  "https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js",
  "https://unpkg.com/stockfish@16.0.0/src/stockfish.js"
];

function makeWorker() {
  const source = `
    let engine = null;
    const urls = ${JSON.stringify(STOCKFISH_URLS)};
    function loadAt(i) {
      if (i >= urls.length) {
        postMessage({ type: "error", message: "Could not load Stockfish. Check your connection, then reload the page." });
        return;
      }
      try {
        importScripts(urls[i]);
        engine = (typeof Stockfish === "function") ? Stockfish() : (typeof STOCKFISH === "function" ? STOCKFISH() : null);
        if (!engine || !engine.postMessage) throw new Error("Engine API not found");
        engine.onmessage = (event) => {
          const line = typeof event === "string" ? event : (event?.data ?? "");
          postMessage({ type: "uci", line: String(line) });
        };
        engine.postMessage("uci");
      } catch (e) { loadAt(i + 1); }
    }
    self.onmessage = (event) => {
      const msg = event.data;
      if (msg?.type === "init") loadAt(0);
      else if (engine && msg?.type === "command") engine.postMessage(msg.command);
    };
  `;
  const blob = new Blob([source], { type: "application/javascript" });
  return new Worker(URL.createObjectURL(blob));
}

const PIECE_NAMES = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function parseInfo(line) {
  const depth = Number(line.match(/\bdepth\s+(\d+)/)?.[1] || 0);
  const multipv = Number(line.match(/\bmultipv\s+(\d+)/)?.[1] || 1);
  const cp = line.match(/\bscore cp (-?\d+)/);
  const mate = line.match(/\bscore mate (-?\d+)/);
  const pv = line.match(/\bpv (.+)$/)?.[1]?.trim().split(/\s+/) || [];
  return { depth, multipv, cp: cp ? Number(cp[1]) : null, mate: mate ? Number(mate[1]) : null, pv };
}

function scoreToWhite(score) {
  if (!score) return 0;
  if (score.mate !== null) return score.mate > 0 ? 100 : -100;
  return (score.cp ?? 0) / 100;
}

function formatEval(score, perspective = "white") {
  if (!score) return "—";
  if (score.mate !== null) {
    const whiteMate = score.mate;
    const shown = perspective === "white" ? whiteMate : -whiteMate;
    return shown > 0 ? `M${shown}` : `−M${Math.abs(shown)}`;
  }
  const val = score.cp / 100 * (perspective === "white" ? 1 : -1);
  return `${val > 0 ? "+" : ""}${val.toFixed(1)}`;
}

function classifyMove(before, after, mover) {
  if (after.mate !== null) return after.mate > 0 ? "Brilliant opportunity" : "Forced mate danger";
  const swing = scoreToWhite(after) - scoreToWhite(before);
  const loss = mover === "white" ? -swing : swing;
  if (loss > 2.5) return "Blunder";
  if (loss > 1.1) return "Mistake";
  if (loss > 0.45) return "Inaccuracy";
  if (loss < -1.2) return "Strong move";
  return "Good move";
}

function explainPosition({ chess, bestMove, score, previousScore, lastMove, loading }) {
  if (loading) return {
    label: "Reading the position",
    title: "Stockfish is calculating",
    body: "The engine is searching candidate moves. Deeper analysis can change the evaluation, so treat early numbers as provisional.",
    tip: "Watch the evaluation and best-move suggestion settle as search depth increases."
  };
  if (chess.isCheckmate()) return {
    label: "Checkmate",
    title: "The game is over",
    body: `${chess.turn() === "w" ? "Black" : "White"} has delivered checkmate. There is no legal reply.`,
    tip: "Step back through the move list to find the turning point."
  };
  if (chess.isDraw()) return {
    label: "Draw",
    title: "The position is drawn",
    body: chess.isStalemate() ? "The side to move has no legal move but is not in check: stalemate." : "The rules recognize this position as a draw.",
    tip: "Look for ways to avoid a drawn ending earlier in the game."
  };
  if (chess.isCheck()) return {
    label: "In check",
    title: "Your king is under attack",
    body: "You must answer the check by moving the king, capturing the checking piece, or blocking the line of attack when legal.",
    tip: bestMove ? `Stockfish's current candidate is ${bestMove}. Check that it resolves the threat.` : "Prioritize king safety before material or attacks."
  };
  const side = chess.turn() === "w" ? "White" : "Black";
  const evalText = score ? formatEval(score, chess.turn() === "w" ? "white" : "black") : "unknown";
  const best = bestMove || "not available yet";
  const material = getMaterialBalance(chess);
  let body = `${side} to move. The current evaluation is ${evalText} from ${side.toLowerCase()}'s perspective. `;
  if (Math.abs(scoreToWhite(score)) < 0.5) body += "The position looks roughly balanced at this search depth. ";
  else if ((scoreToWhite(score) > 0) === (chess.turn() === "w")) body += "White has the engine's edge, but the exact plan depends on king safety and piece activity. ";
  else body += "Black has the engine's edge; the side to move should look for active defence and counterplay. ";
  body += `Material count: ${material}.`;
  return {
    label: "Position overview",
    title: `Best candidate: ${best}`,
    body,
    tip: "Compare the engine's principal variation with your plan. Check forcing moves first: checks, captures, and direct threats."
  };
}

function getMaterialBalance(chess) {
  const board = chess.board();
  let white = 0, black = 0;
  for (const row of board) for (const p of row) if (p) {
    const v = PIECE_VALUES[p.type] || 0;
    if (p.color === "w") white += v; else black += v;
  }
  const diff = white - black;
  return diff === 0 ? "equal material" : `${diff > 0 ? "White" : "Black"} is up ${Math.abs(diff)} point${Math.abs(diff) === 1 ? "" : "s"} of material`;
}

function moveToSanList(moves) {
  return moves.map((m, i) => ({
    ...m,
    number: Math.floor(i / 2) + 1,
    display: `${Math.floor(i / 2) + 1}${i % 2 === 0 ? "." : "..."} ${m.san}`
  }));
}

export default function App() {
  const chessRef = useRef(new Chess());
  const workerRef = useRef(null);
  const analyseIdRef = useRef(0);
  const lastScoreRef = useRef(null);
  const [fen, setFen] = useState(chessRef.current.fen());
  const [history, setHistory] = useState([]);
  const [cursor, setCursor] = useState(-1);
  const [engineState, setEngineState] = useState("starting");
  const [engineMessage, setEngineMessage] = useState("Starting Stockfish…");
  const [analysis, setAnalysis] = useState(null);
  const [lines, setLines] = useState({});
  const [depth, setDepth] = useState(14);
  const [showArrows, setShowArrows] = useState(true);
  const [fenInput, setFenInput] = useState("");
  const [pgnInput, setPgnInput] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [selectedTab, setSelectedTab] = useState("coach");
  const [moveInsights, setMoveInsights] = useState([]);
  const [lastInsight, setLastInsight] = useState(null);
  const [boardOrientation, setBoardOrientation] = useState("white");
  const [copied, setCopied] = useState(false);

  const chess = chessRef.current;
  const moves = useMemo(() => moveToSanList(history), [history]);
  const currentMove = cursor >= 0 ? history[cursor] : null;

  useEffect(() => {
    let worker;
    try {
      worker = makeWorker();
      workerRef.current = worker;
      worker.onmessage = ({ data }) => {
        if (data.type === "error") {
          setEngineState("error");
          setEngineMessage(data.message);
          return;
        }
        const line = data.line || "";
        if (line.includes("uciok")) {
          worker.postMessage({ type: "command", command: "isready" });
          setEngineState("ready");
          setEngineMessage("Stockfish connected");
        }
        if (line.includes("readyok")) {
          analysePosition();
        }
        if (line.startsWith("info ") && line.includes(" score ")) {
          const parsed = parseInfo(line);
          if (!parsed.depth) return;
          setLines(old => ({ ...old, [parsed.multipv]: parsed }));
          if (parsed.multipv === 1) {
            setAnalysis(parsed);
          }
        }
        if (line.startsWith("bestmove ")) {
          const best = line.split(/\s+/)[1];
          setAnalysis(old => old ? { ...old, bestMove: best } : { bestMove: best });
          setEngineMessage("Analysis complete for current position");
        }
      };
      worker.onerror = () => {
        setEngineState("error");
        setEngineMessage("Stockfish worker failed to start. Try refreshing or check network access.");
      };
      worker.postMessage({ type: "init" });
    } catch (e) {
      setEngineState("error");
      setEngineMessage("Your browser could not start the Stockfish worker.");
    }
    return () => { if (worker) worker.terminate(); };
    // analysePosition is intentionally called via worker messages and defined by a stable callback below.
  }, []);

  const analysePosition = useCallback(() => {
    const worker = workerRef.current;
    if (!worker || engineState === "error") return;
    const id = ++analyseIdRef.current;
    const positionFen = chessRef.current.fen();
    setAnalysis(old => ({ ...(old || {}), bestMove: null, depth: 0 }));
    setLines({});
    setEngineMessage("Analysing current position…");
    worker.postMessage({ type: "command", command: "stop" });
    worker.postMessage({ type: "command", command: "ucinewgame" });
    worker.postMessage({ type: "command", command: `setoption name MultiPV value 3` });
    worker.postMessage({ type: "command", command: `position fen ${positionFen}` });
    worker.postMessage({ type: "command", command: `go depth ${depth}` });
  }, [depth, engineState]);

  useEffect(() => {
    if (engineState === "ready") {
      const timer = setTimeout(() => analysePosition(), 120);
      return () => clearTimeout(timer);
    }
  }, [fen, depth, engineState, analysePosition]);

  const commitGame = (newChess, newHistory) => {
    chessRef.current = newChess;
    setFen(newChess.fen());
    setHistory(newHistory);
    setCursor(newHistory.length - 1);
    setMoveInsights([]);
    setLastInsight(null);
  };

  const onPieceDrop = ({ sourceSquare, targetSquare }) => {
    if (!targetSquare) return false;
    const game = new Chess(chessRef.current.fen());
    try {
      const mover = game.turn() === "w" ? "white" : "black";
      const before = analysis;
      const move = game.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
      if (!move) return false;
      const newHistory = [...game.history({ verbose: true })];
      commitGame(game, newHistory);
      setLastInsight({
        san: move.san,
        mover,
        before: before || null,
        label: before?.bestMove ? (move.from + move.to === before.bestMove.slice(0, 4) ? "Engine's top move" : "Move played") : "Move played",
        note: before?.bestMove && move.from + move.to !== before.bestMove.slice(0, 4)
          ? `Stockfish's previous top line started with ${before.bestMove}. The next evaluation will show whether ${move.san} changed the position's balance.`
          : "This move matched Stockfish's current top candidate, based on the search available before the move."
      });
      return true;
    } catch {
      return false;
    }
  };

  const navigateTo = (idx) => {
    const game = new Chess();
    for (let i = 0; i <= idx; i++) {
      const m = history[i];
      if (m) game.move({ from: m.from, to: m.to, promotion: m.promotion || "q" });
    }
    chessRef.current = game;
    setFen(game.fen());
    setCursor(idx);
  };

  const newGame = () => {
    const game = new Chess();
    chessRef.current = game;
    setFen(game.fen());
    setHistory([]);
    setCursor(-1);
    setAnalysis(null);
    setLines({});
    setMoveInsights([]);
    setLastInsight(null);
    setBoardOrientation("white");
  };

  const undoMove = () => {
    if (!history.length) return;
    const newHistory = history.slice(0, -1);
    const game = new Chess();
    for (const m of newHistory) game.move({ from: m.from, to: m.to, promotion: m.promotion || "q" });
    commitGame(game, newHistory);
  };

  const importFEN = () => {
    try {
      const game = new Chess(fenInput.trim());
      commitGame(game, []);
      setImportOpen(false);
      setFenInput("");
    } catch {
      alert("That FEN looks invalid. Please check it and try again.");
    }
  };

  const importPGN = () => {
    try {
      const game = new Chess();
      game.loadPgn(pgnInput.trim());
      const newHistory = game.history({ verbose: true });
      commitGame(game, newHistory);
      setImportOpen(false);
      setPgnInput("");
    } catch {
      alert("Could not read that PGN. Check the notation and try again.");
    }
  };

  const copyFen = async () => {
    try {
      await navigator.clipboard.writeText(chessRef.current.fen());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { setCopied(false); }
  };

  const bestMove = analysis?.bestMove;
  const topLines = Object.values(lines).sort((a, b) => a.multipv - b.multipv).slice(0, 3);
  const overview = explainPosition({
    chess: new Chess(fen),
    bestMove,
    score: analysis,
    previousScore: lastScoreRef.current,
    lastMove: currentMove,
    loading: engineState !== "ready" || !analysis?.depth
  });
  const boardOptions = {
    position: fen,
    onPieceDrop,
    boardOrientation,
    allowDragging: !chess.isGameOver(),
    boardWidth: 560,
    animationDuration: 160,
    showNotation: true,
    customDarkSquareStyle: { backgroundColor: "#73966c" },
    customLightSquareStyle: { backgroundColor: "#e8e6d7" },
    customBoardStyle: { borderRadius: "10px", overflow: "hidden" },
    customArrows: showArrows && bestMove && bestMove.length >= 4 ? [[bestMove.slice(0, 2), bestMove.slice(2, 4), "#e7b34f"]] : []
  };

  const latestMove = history.at(-1);
  const turnLabel = chess.turn() === "w" ? "White to move" : "Black to move";
  const evalWhite = analysis ? scoreToWhite(analysis) : 0;
  const whitePercent = Math.max(5, Math.min(95, 50 + evalWhite * 10));
  const bestSan = useMemo(() => {
    if (!bestMove || bestMove.length < 4) return null;
    try {
      const g = new Chess(fen);
      const m = g.move({ from: bestMove.slice(0, 2), to: bestMove.slice(2, 4), promotion: bestMove[4] || "q" });
      return m?.san || bestMove;
    } catch { return bestMove; }
  }, [bestMove, fen]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={e => e.preventDefault()}>
          <div className="brand-mark"><span>♞</span></div>
          <div><strong>chess<span>coach</span></strong><small>YOUR PERSONAL ANALYST</small></div>
        </a>
        <div className="topbar-right">
          <div className={`engine-pill ${engineState}`}><span className="status-dot" />{engineState === "ready" ? "Stockfish engine" : engineState === "error" ? "Engine offline" : "Connecting engine"}</div>
          <button className="icon-button" title="Import position or game" onClick={() => setImportOpen(v => !v)}><Clipboard size={17}/><span>Import</span></button>
          <button className="primary-button" onClick={newGame}><RotateCcw size={16}/> New game</button>
        </div>
      </header>

      <main className="main-layout">
        <section className="left-column">
          <div className="page-heading">
            <div><div className="eyebrow"><span className="eyebrow-line"/> LIVE GAME ANALYSIS</div><h1>See the game <em>clearly.</em></h1><p>Every move, explained in plain English.</p></div>
            <div className="depth-control"><label htmlFor="depth">ENGINE DEPTH</label><select id="depth" value={depth} onChange={e => setDepth(Number(e.target.value))}><option value={10}>10 · Fast</option><option value={14}>14 · Balanced</option><option value={18}>18 · Deep</option><option value={22}>22 · Very deep</option></select></div>
          </div>

          {importOpen && <div className="import-panel">
            <div className="import-head"><strong>Load a position or game</strong><button className="text-button" onClick={() => setImportOpen(false)}>Close</button></div>
            <label>FEN position</label><div className="import-row"><input value={fenInput} onChange={e => setFenInput(e.target.value)} placeholder="Paste FEN notation…"/><button className="small-button" onClick={importFEN}>Load FEN</button></div>
            <label>PGN game</label><textarea value={pgnInput} onChange={e => setPgnInput(e.target.value)} placeholder="Paste a PGN game…"/><button className="small-button" onClick={importPGN}>Load PGN</button>
          </div>}

          <div className="board-toolbar"><div className="game-tag"><span className="live-dot"/> LIVE BOARD <span className="toolbar-divider"/> {turnLabel}</div><div className="board-actions"><button className="icon-button compact" onClick={() => setBoardOrientation(v => v === "white" ? "black" : "white")} title="Flip board">⇅ <span>Flip</span></button><button className={`icon-button compact ${showArrows ? "active" : ""}`} onClick={() => setShowArrows(v => !v)} title="Toggle best move arrow"><Target size={15}/><span>Best move arrow</span></button></div></div>

          <div className="board-and-eval">
            <div className="eval-bar" aria-label={`Evaluation ${analysis ? formatEval(analysis, "white") : "loading"}`}><div className="eval-black" style={{height:`${100-whitePercent}%`}}/><div className="eval-white" style={{height:`${whitePercent}%`}}/><span className="eval-label">{analysis ? formatEval(analysis, "white") : "…"}</span></div>
            <div className="board-wrap"><Chessboard options={boardOptions}/></div>
          </div>

          <div className="board-footer">
            <div className="turn-indicator"><span className={`turn-piece ${chess.turn() === "w" ? "white-piece" : "black-piece"}`}>{chess.turn() === "w" ? "♙" : "♟"}</span><div><strong>{turnLabel}</strong><small>{chess.isCheck() ? "King in check" : chess.isGameOver() ? "Game finished" : "Make a move on the board"}</small></div></div>
            <div className="move-controls"><button className="square-button" title="First position" onClick={() => navigateTo(-1)}><ArrowLeft size={15}/><ArrowLeft size={15} className="double-arrow"/></button><button className="square-button" title="Undo last move" onClick={undoMove} disabled={!history.length}><Undo2 size={16}/></button><button className="square-button" title="Previous move" onClick={() => navigateTo(Math.max(-1, cursor - 1))} disabled={cursor < 0}><ArrowLeft size={16}/></button><button className="square-button" title="Next move" onClick={() => navigateTo(Math.min(history.length - 1, cursor + 1))} disabled={cursor >= history.length - 1}><ArrowRight size={16}/></button><button className="square-button" title="Copy FEN" onClick={copyFen}><Clipboard size={15}/></button></div>
          </div>

          <div className="moves-card">
            <div className="section-title"><div><span className="section-icon"><Activity size={16}/></span><h2>Move history</h2></div><span className="muted-count">{history.length} plies</span></div>
            {moves.length === 0 ? <div className="empty-moves"><span className="empty-knight">♘</span><span>Your game starts here.</span><small>Play a move or import a PGN to review a game.</small></div> : <div className="move-list">{Array.from({length:Math.ceil(moves.length/2)},(_,i)=><div className="move-row" key={i}><span className="move-number">{i+1}.</span><button className={cursor===i*2?"selected":""} onClick={()=>navigateTo(i*2)}>{moves[i*2]?.san}</button><button className={cursor===i*2+1?"selected":""} onClick={()=>moves[i*2+1]&&navigateTo(i*2+1)}>{moves[i*2+1]?.san || ""}</button></div>)}</div>}
            <div className="fen-row"><span>POSITION FEN</span><code>{fen}</code><button onClick={copyFen}>{copied ? <Check size={14}/> : <Clipboard size={14}/>} {copied ? "Copied" : "Copy"}</button></div>
          </div>
        </section>

        <aside className="right-column">
          <div className="coach-card">
            <div className="coach-top"><div className="coach-icon"><Brain size={19}/></div><div><div className="coach-overline">YOUR CHESS COACH</div><h2>Position breakdown</h2></div><span className="live-badge"><span/> LIVE</span></div>
            <div className="position-state"><span className="state-dot"/>{overview.label}</div>
            <h3>{overview.title}</h3>
            <p className="coach-copy">{overview.body}</p>
            <div className="coach-tip"><Lightbulb size={17}/><div><strong>Coach's thought</strong><p>{overview.tip}</p></div></div>
            <div className="engine-status-line"><span className={`status-dot ${engineState === "error" ? "error-dot" : ""}`}/><span>{engineMessage}</span><span className="depth-number">{analysis?.depth ? `D${analysis.depth}` : ""}</span></div>
          </div>

          <div className="best-move-card">
            <div className="section-title"><div><span className="section-icon gold"><Zap size={16}/></span><h2>Best move</h2></div><span className="engine-label"><Cpu size={13}/> STOCKFISH</span></div>
            <div className="best-move-main"><div className="move-piece-icon">♞</div><div className="best-move-text"><strong>{bestSan || (engineState === "error" ? "Engine unavailable" : "Calculating…")}</strong><span>{bestMove ? bestMove : "Waiting for engine output"}</span></div><div className="eval-chip">{analysis ? formatEval(analysis, chess.turn() === "w" ? "white" : "black") : "—"}</div></div>
            <div className="variation-label">TOP CANDIDATE LINES</div>
            {topLines.length ? topLines.map((line,i)=><div className="variation-row" key={line.multipv}><span className="variation-rank">{i+1}</span><span className="variation-moves">{line.pv?.slice(0,5).join(" ") || "Searching…"}</span><span className="variation-eval">{formatEval(line, "white")}</span></div>) : <div className="variation-placeholder">Engine variations appear as the position is analysed.</div>}
            <div className="engine-foot"><span><Gauge size={13}/> Search depth</span><strong>{analysis?.depth || 0} / {depth}</strong></div><div className="depth-track"><div style={{width:`${Math.min(100,(analysis?.depth||0)/depth*100)}%`}}/></div>
          </div>

          <div className="tabs-card">
            <div className="tabs"><button className={selectedTab==="coach"?"active":""} onClick={()=>setSelectedTab("coach")}><Sparkles size={14}/> Coach notes</button><button className={selectedTab==="mistakes"?"active":""} onClick={()=>setSelectedTab("mistakes")}><TrendingDown size={14}/> Mistakes</button></div>
            {selectedTab==="coach" ? <div className="tab-content"><div className="note-item"><span className="note-icon"><Target size={15}/></span><div><strong>Think in forcing moves</strong><p>Before choosing a move, check every check, capture, and direct threat for both sides.</p></div></div><div className="note-item"><span className="note-icon"><ShieldIcon/></span><div><strong>Keep your king safe</strong><p>Look for undefended pieces and lines opening toward your king after each exchange.</p></div></div><div className="note-item"><span className="note-icon"><Brain size={15}/></span><div><strong>Understand, don't memorise</strong><p>Use the top engine line to test your idea. Ask what changes after the opponent's best reply.</p></div></div></div> : <div className="tab-content"><div className="note-item"><span className="note-icon warning"><CircleHelp size={15}/></span><div><strong>Move-by-move grading</strong><p>Play or load a game to compare positions. This first version shows engine candidates and position evaluation; reliable accuracy grading needs analysing both sides' before-and-after positions.</p></div></div><div className="note-item"><span className="note-icon"><TrendingDown size={15}/></span><div><strong>What to look for</strong><p>Large evaluation swings often signal a missed tactic, hanging piece, or king-safety problem.</p></div></div></div>}
          </div>

          <div className="disclaimer"><CircleHelp size={15}/><p><strong>Engine insight, not magic.</strong> Stockfish calculates strong candidate moves. The plain-English coaching here interprets the position; it is not a full human-level explanation of every strategic idea.</p></div>
        </aside>
      </main>
      <footer><div className="footer-brand">♞ chesscoach</div><span>Analysis powered by Stockfish · Built for learning</span><span className="footer-right">Your games stay in this browser</span></footer>
    </div>
  );
}

function ShieldIcon() {
  return <Flag size={15}/>;
}
