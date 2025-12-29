import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { config } from "./config/config";
import "./App.css";

// Create darker shade for 3D effect
const darkenColor = (r: number, g: number, b: number, factor: number) => {
  return `rgb(${Math.floor(r * factor)}, ${Math.floor(g * factor)}, ${Math.floor(b * factor)})`;
};

// Create lighter shade for highlight
const lightenColor = (r: number, g: number, b: number, factor: number) => {
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
  const color = config.colors[colorIdx % config.colors.length];

  // Calculate stitch direction
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.5) return;

  // Perpendicular unit vector
  const px = -dy / len;
  const py = dx / len;

  // Colors: main, subtle shadow, subtle highlight
  const main = `rgb(${color.r}, ${color.g}, ${color.b})`;
  const shadow = darkenColor(color.r, color.g, color.b, 0.6);
  const highlight = lightenColor(color.r, color.g, color.b, 0.35);

  // Small offset for depth
  const offset = threadWidth * 0.25;

  ctx.lineCap = "round";

  // Layer 1: Subtle shadow (slightly offset)
  ctx.beginPath();
  ctx.moveTo(x1 + px * offset, y1 + py * offset);
  ctx.lineTo(x2 + px * offset, y2 + py * offset);
  ctx.strokeStyle = shadow;
  ctx.lineWidth = threadWidth;
  ctx.stroke();

  // Layer 2: Main thread
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = main;
  ctx.lineWidth = threadWidth;
  ctx.stroke();

  // Layer 3: Thin highlight line
  ctx.beginPath();
  ctx.moveTo(x1 - px * offset * 0.4, y1 - py * offset * 0.4);
  ctx.lineTo(x2 - px * offset * 0.4, y2 - py * offset * 0.4);
  ctx.strokeStyle = highlight;
  ctx.lineWidth = threadWidth * 0.25;
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
    const { padding, maxSize, backgroundColor } = config.canvas;
    const viewportMax = Math.min(window.innerWidth - 100, window.innerHeight - 100, maxSize);
    const scale = Math.min(
      (viewportMax - padding * 2) / patternWidth,
      (viewportMax - padding * 2) / patternHeight
    );

    // Set canvas size
    canvas.width = patternWidth * scale + padding * 2;
    canvas.height = patternHeight * scale + padding * 2;

    // Clear canvas with background color
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Coordinate transforms
    const tx = (x: number) => (x - min_x) * scale + padding;
    const ty = (y: number) => (y - min_y) * scale + padding;

    // Thread width based on scale (clamped to min/max)
    const { width, minWidth, maxWidth } = config.thread;
    const threadWidth = Math.max(minWidth, Math.min(maxWidth, scale * width * 0.4));

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
    const ext = filePath.toLowerCase().slice(filePath.lastIndexOf("."));
    if (!(config.formats.supported as readonly string[]).includes(ext)) {
      setError(`Unsupported format. Supported: ${config.formats.supported.join(", ")}`);
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
    const unlistenLeave = listen("tauri://drag-leave", () => setIsDragging(false));
    const unlistenDrop = listen<{ paths: string[] }>("tauri://drag-drop", (e) => {
      setIsDragging(false);
      if (e.payload.paths?.[0]) loadFile(e.payload.paths[0]);
    });

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
          <img src="/icons/upload.svg" alt="Upload" className="drop-zone-icon" />
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
