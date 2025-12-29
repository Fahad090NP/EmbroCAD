import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

// Default thread palette when colors aren't specified
const DEFAULT_COLORS = [
  "#000000",
  "#1a1a8c",
  "#0a5f1c",
  "#8c1a1a",
  "#8c1a6b",
  "#5c4d1a",
  "#8c8c8c",
  "#4d4d4d",
  "#3366cc",
  "#33cc66",
  "#cc3333",
  "#cc66cc",
  "#cccc33",
  "#ffffff",
  "#1a1a1a",
];

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

    // Set canvas size with padding
    const padding = 40;
    const maxSize = Math.min(
      window.innerWidth - 80,
      window.innerHeight - 80,
      800
    );
    const scale = Math.min(
      (maxSize - padding * 2) / patternWidth,
      (maxSize - padding * 2) / patternHeight
    );

    canvas.width = patternWidth * scale + padding * 2;
    canvas.height = patternHeight * scale + padding * 2;

    // Clear canvas
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Transform coordinates
    const transformX = (x: number) => (x - min_x) * scale + padding;
    const transformY = (y: number) => (y - min_y) * scale + padding;

    // Draw stitches
    let colorIndex = 0;
    let isDrawing = false;

    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const stitch of pattern.stitches) {
      const x = transformX(stitch.x);
      const y = transformY(stitch.y);

      switch (stitch.command) {
        case "STITCH":
          if (!isDrawing) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.strokeStyle =
              DEFAULT_COLORS[colorIndex % DEFAULT_COLORS.length];
            isDrawing = true;
          } else {
            ctx.lineTo(x, y);
          }
          break;

        case "MOVE":
          if (isDrawing) {
            ctx.stroke();
            isDrawing = false;
          }
          break;

        case "COLOR_CHANGE":
          if (isDrawing) {
            ctx.stroke();
            isDrawing = false;
          }
          colorIndex++;
          break;

        case "END":
          if (isDrawing) {
            ctx.stroke();
            isDrawing = false;
          }
          break;

        default:
          break;
      }
    }

    // Finish any remaining path
    if (isDrawing) {
      ctx.stroke();
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

  // Listen for Tauri drag-drop events
  useEffect(() => {
    const unlistenHover = listen<{ paths: string[] }>(
      "tauri://drag-over",
      () => {
        setIsDragging(true);
      }
    );

    const unlistenLeave = listen("tauri://drag-leave", () => {
      setIsDragging(false);
    });

    const unlistenDrop = listen<{ paths: string[] }>(
      "tauri://drag-drop",
      (event) => {
        setIsDragging(false);
        const paths = event.payload.paths;
        if (paths && paths.length > 0) {
          loadFile(paths[0]);
        }
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
          <p>Loading embroidery design...</p>
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
