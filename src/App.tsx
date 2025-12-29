import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

// Thread colors - base color with calculated shadow
const THREAD_COLORS = [
  { r: 0, g: 0, b: 0 }, // Black
  { r: 26, g: 26, b: 140 }, // Navy Blue
  { r: 10, g: 95, b: 28 }, // Dark Green
  { r: 140, g: 26, b: 26 }, // Dark Red
  { r: 140, g: 26, b: 107 }, // Purple
  { r: 92, g: 77, b: 26 }, // Brown
  { r: 140, g: 140, b: 140 }, // Gray
  { r: 77, g: 77, b: 77 }, // Dark Gray
  { r: 51, g: 102, b: 204 }, // Blue
  { r: 51, g: 204, b: 102 }, // Green
  { r: 204, g: 51, b: 51 }, // Red
  { r: 204, g: 102, b: 204 }, // Pink
  { r: 204, g: 204, b: 51 }, // Yellow
  { r: 230, g: 230, b: 230 }, // White
  { r: 26, g: 26, b: 26 }, // Charcoal
];

// Create darker shade for 3D effect
const darkenColor = (r: number, g: number, b: number, factor = 0.5) => {
  return `rgb(${Math.floor(r * factor)}, ${Math.floor(
    g * factor
  )}, ${Math.floor(b * factor)})`;
};

// Create lighter shade for highlight
const lightenColor = (r: number, g: number, b: number, factor = 0.3) => {
  return `rgb(${Math.floor(r + (255 - r) * factor)}, ${Math.floor(
    g + (255 - g) * factor
  )}, ${Math.floor(b + (255 - b) * factor)})`;
};

interface Stitch {
  x: number;
  y: number;
  command: string;
}

interface Bounds {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

interface Pattern {
  stitches: Stitch[];
  bounds: Bounds | null;
  color_changes: number;
  metadata: {
    label: string | null;
    stitch_count: number | null;
    color_count: number | null;
  };
}

type AppState = "idle" | "loading" | "preview" | "error";

// Draw a single stitch with 3D thread effect
const drawStitch = (
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  colorIdx: number,
  threadWidth: number
) => {
  const color = THREAD_COLORS[colorIdx % THREAD_COLORS.length];
  const mainColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
  const shadowColor = darkenColor(color.r, color.g, color.b, 0.4);
  const highlightColor = lightenColor(color.r, color.g, color.b, 0.4);

  // Calculate perpendicular offset for shadow/highlight
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.5) return;

  // Perpendicular unit vector
  const px = -dy / len;
  const py = dx / len;

  // Shadow offset (about 30% of thread width)
  const shadowOffset = threadWidth * 0.3;

  // Draw shadow stroke (darker, offset down-right)
  ctx.beginPath();
  ctx.moveTo(x1 + px * shadowOffset, y1 + py * shadowOffset);
  ctx.lineTo(x2 + px * shadowOffset, y2 + py * shadowOffset);
  ctx.strokeStyle = shadowColor;
  ctx.lineWidth = threadWidth;
  ctx.lineCap = "round";
  ctx.stroke();

  // Draw main stroke
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = mainColor;
  ctx.lineWidth = threadWidth;
  ctx.lineCap = "round";
  ctx.stroke();

  // Draw highlight (lighter, offset up-left, thinner)
  ctx.beginPath();
  ctx.moveTo(x1 - px * shadowOffset * 0.5, y1 - py * shadowOffset * 0.5);
  ctx.lineTo(x2 - px * shadowOffset * 0.5, y2 - py * shadowOffset * 0.5);
  ctx.strokeStyle = highlightColor;
  ctx.lineWidth = threadWidth * 0.3;
  ctx.lineCap = "round";
  ctx.stroke();
};

function App() {
  const [state, setState] = useState<AppState>("idle");
  const [pattern, setPattern] = useState<Pattern | null>(null);
  const [error, setError] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const renderPattern = useCallback((pattern: Pattern) => {
    const canvas = canvasRef.current;
    if (!canvas || !pattern.bounds) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { min_x, min_y, max_x, max_y } = pattern.bounds;
    const patternWidth = max_x - min_x;
    const patternHeight = max_y - min_y;

    // Calculate scale to fit viewport
    const padding = 50;
    const maxSize = Math.min(
      window.innerWidth - 100,
      window.innerHeight - 100,
      1200
    );
    const scale = Math.min(
      (maxSize - padding * 2) / patternWidth,
      (maxSize - padding * 2) / patternHeight
    );

    // Set canvas size
    canvas.width = patternWidth * scale + padding * 2;
    canvas.height = patternHeight * scale + padding * 2;

    // Clear canvas with white background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Coordinate transforms
    const tx = (x: number) => (x - min_x) * scale + padding;
    const ty = (y: number) => (y - min_y) * scale + padding;

    // Thread width based on scale (realistic thickness)
    const threadWidth = Math.max(1.5, Math.min(3, scale * 0.8));

    // Track state
    let colorIdx = 0;
    let prevX = 0;
    let prevY = 0;
    let hasStart = false;

    // Draw each stitch individually with 3D effect
    for (const stitch of pattern.stitches) {
      const x = tx(stitch.x);
      const y = ty(stitch.y);

      switch (stitch.command) {
        case "STITCH":
          if (hasStart) {
            drawStitch(ctx, prevX, prevY, x, y, colorIdx, threadWidth);
          }
          prevX = x;
          prevY = y;
          hasStart = true;
          break;

        case "MOVE":
          prevX = x;
          prevY = y;
          hasStart = true;
          break;

        case "COLOR_CHANGE":
          colorIdx++;
          prevX = x;
          prevY = y;
          hasStart = true;
          break;

        case "END":
          break;

        default:
          break;
      }
    }
  }, []);

  const loadFile = useCallback(async (filePath: string) => {
    if (!filePath.toLowerCase().endsWith(".dst")) {
      setError("Please drop a .DST file");
      setState("error");
      return;
    }

    setState("loading");

    try {
      const result = await invoke<Pattern>("parse_dst_file", {
        path: filePath,
      });
      setPattern(result);
      setState("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }, []);

  useEffect(() => {
    if (pattern && state === "preview") {
      renderPattern(pattern);
    }
  }, [pattern, state, renderPattern]);

  // Listen for drag-drop events
  useEffect(() => {
    const unlistenHover = listen<{ paths: string[] }>("tauri://drag-over", () =>
      setIsDragging(true)
    );
    const unlistenLeave = listen("tauri://drag-leave", () =>
      setIsDragging(false)
    );
    const unlistenDrop = listen<{ paths: string[] }>(
      "tauri://drag-drop",
      (e) => {
        setIsDragging(false);
        if (e.payload.paths?.[0]) loadFile(e.payload.paths[0]);
      }
    );

    return () => {
      unlistenHover.then((fn) => fn());
      unlistenLeave.then((fn) => fn());
      unlistenDrop.then((fn) => fn());
    };
  }, [loadFile]);

  const resetToIdle = useCallback(() => {
    setState("idle");
    setPattern(null);
    setError("");
  }, []);

  return (
    <div className={`app ${isDragging ? "dragging" : ""}`}>
      {state === "idle" && (
        <div className={`drop-zone ${isDragging ? "dragging" : ""}`}>
          <img
            src="/icons/upload.svg"
            alt="Upload"
            className="drop-zone-icon"
          />
          <p className="drop-zone-text">Drop a DST file here</p>
          <p className="drop-zone-hint">Embroidery design will be previewed</p>
        </div>
      )}

      {state === "loading" && (
        <div className="loading">
          <div className="loading-spinner" />
          <p>Rendering embroidery design...</p>
        </div>
      )}

      {state === "preview" && (
        <div className="canvas-container" onClick={resetToIdle}>
          <canvas ref={canvasRef} className="stitch-canvas" />
        </div>
      )}

      {state === "error" && (
        <div className="error">
          <img src="/icons/error.svg" alt="Error" className="error-icon" />
          <p className="error-title">Failed to load design</p>
          <p className="error-message">{error}</p>
          <button className="retry-button" onClick={resetToIdle}>
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
