import React, { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Settings,
  XCircle,
  Plus,
  Minus,
  Maximize2,
  Minimize2,
  X,
  ChevronLeft,
  ChevronRight,
  FileImage,
  FolderOpen,
  Info,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuShortcut,
} from "./components/ui/context-menu";
import { SettingsDialog } from "./components/settings-dialog";
import "./App.css";

// Thread colors - inline for zero lookup overhead
const COLORS = [
  [0, 0, 0], // Black
  [26, 26, 140], // Navy Blue
  [10, 95, 28], // Dark Green
  [140, 26, 26], // Dark Red
  [140, 26, 107], // Purple
  [92, 77, 26], // Brown
  [140, 140, 140], // Gray
  [77, 77, 77], // Dark Gray
  [51, 102, 204], // Blue
  [51, 204, 102], // Green
  [204, 51, 51], // Red
  [204, 102, 204], // Pink
  [204, 204, 51], // Yellow
  [230, 230, 230], // White
  [26, 26, 26], // Charcoal
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

interface PatternStatistics {
  real_stitch_count: number;
  jump_count: number;
  color_change_count: number;
  estimated_time_minutes: number;
}

interface Pattern {
  stitches: Stitch[];
  bounds: Bounds | null;
  statistics: PatternStatistics;
  color_changes: number;
  metadata: {
    label: string | null;
    stitch_count: number | null;
    color_count: number | null;
  };
}

interface Tab {
  id: string;
  name: string;
  filePath: string | null;
  pattern: Pattern | null;
}

const SUPPORTED_FORMATS = [".dst"];

// Helper for formatting numbers with commas
const NumberDisplay = ({ value }: { value: number }) => {
  return <span>{value.toLocaleString()}</span>;
};

// Helper for formatting time
const TimeDisplay = ({ minutes }: { minutes: number }) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0) {
    return (
      <span>
        {h}h {m}m
      </span>
    );
  }
  return <span>{m}m</span>;
};

function App() {
  const [tabs, setTabs] = useState<Tab[]>([
    { id: "1", name: "Empty", filePath: null, pattern: null },
  ]);
  const [activeTabId, setActiveTabId] = useState("1");
  const [isMaximized, setIsMaximized] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [dragZone, setDragZone] = useState<"header" | "canvas" | null>(null);
  const [ghostTabIndex, setGhostTabIndex] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tabsScrollRef = useRef<HTMLDivElement>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Check maximized state on mount and listen for changes
  useEffect(() => {
    const checkMaximized = async () => {
      const maximized = await getCurrentWindow().isMaximized();
      setIsMaximized(maximized);
    };
    void checkMaximized();

    const unlisten = getCurrentWindow().onResized(() => {
      void checkMaximized();
    });

    return () => {
      void unlisten.then((fn) => {
        fn();
      });
    };
  }, []);

  // Check scroll state for tabs
  const checkTabsScroll = useCallback(() => {
    const container = tabsScrollRef.current;
    if (!container) {
      return;
    }

    setCanScrollLeft(container.scrollLeft > 0);
    setCanScrollRight(container.scrollLeft < container.scrollWidth - container.clientWidth - 1);
  }, []);

  useEffect(() => {
    checkTabsScroll();
    window.addEventListener("resize", checkTabsScroll);
    return () => {
      window.removeEventListener("resize", checkTabsScroll);
    };
  }, [checkTabsScroll, tabs]);

  // Scroll tabs
  const scrollTabs = (direction: "left" | "right") => {
    const container = tabsScrollRef.current;
    if (!container) {
      return;
    }

    const scrollAmount = 150;
    container.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });

    setTimeout(checkTabsScroll, 300);
  };

  // Window controls
  const handleMinimize = async () => {
    await getCurrentWindow().minimize();
  };
  const handleMaximize = async () => {
    await getCurrentWindow().toggleMaximize();
    const maximized = await getCurrentWindow().isMaximized();
    setIsMaximized(maximized);
  };
  const handleClose = async () => {
    await getCurrentWindow().close();
  };

  // Start window drag
  const handleStartDrag = async (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest(".tab")) {
      return;
    }
    await getCurrentWindow().startDragging();
  };

  // Tab operations
  const addNewTab = useCallback(() => {
    const existingEmptyTab = tabs.find((t) => t.pattern === null);
    if (existingEmptyTab) {
      setActiveTabId(existingEmptyTab.id);
      return;
    }

    const newId = Date.now().toString();
    setTabs([...tabs, { id: newId, name: "Empty", filePath: null, pattern: null }]);
    setActiveTabId(newId);
    setTimeout(checkTabsScroll, 100);
  }, [tabs, checkTabsScroll]);

  const closeTab = useCallback(
    (tabId: string) => {
      if (tabs.length === 1) {
        return;
      }
      const newTabs = tabs.filter((t) => t.id !== tabId);
      setTabs(newTabs);
      if (activeTabId === tabId) {
        setActiveTabId(newTabs[0].id);
      }
      setTimeout(checkTabsScroll, 100);
    },
    [tabs, activeTabId, checkTabsScroll]
  );

  // Progressive pattern rendering - shows design building up
  const renderPatternRef = useRef<number | null>(null);

  const renderPattern = useCallback((pattern: Pattern) => {
    const canvas = canvasRef.current;
    if (!canvas || !pattern.bounds) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    // Cancel any ongoing render
    if (renderPatternRef.current) {
      cancelAnimationFrame(renderPatternRef.current);
      renderPatternRef.current = null;
    }

    const { min_x, min_y, max_x, max_y } = pattern.bounds;
    const patternWidth = max_x - min_x;
    const patternHeight = max_y - min_y;

    const container = canvas.parentElement;
    if (!container) {
      return;
    }

    const containerWidth = container.clientWidth - 40;
    const containerHeight = container.clientHeight - 40;
    const scale = Math.min(containerWidth / patternWidth, containerHeight / patternHeight);

    // Set canvas size immediately so user sees the canvas
    canvas.width = patternWidth * scale;
    canvas.height = patternHeight * scale;

    // Clear canvas (transparent) to let CSS background show through
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const threadWidth = Math.max(1.5, Math.min(4.0, scale * 1.5 * 0.4));
    const offset = threadWidth * 0.25;
    ctx.lineCap = "round";

    const stitches = pattern.stitches;
    const totalStitches = stitches.length;
    const STITCHES_PER_FRAME = 8000; // Balanced: visible effect + reasonable speed

    let currentIndex = 0;
    let colorIdx = 0;
    let prevX = 0;
    let prevY = 0;
    let hasStart = false;

    const renderChunk = () => {
      const endIndex = Math.min(currentIndex + STITCHES_PER_FRAME, totalStitches);

      for (let i = currentIndex; i < endIndex; i++) {
        const stitch = stitches[i];
        const x = (stitch.x - min_x) * scale;
        const y = (stitch.y - min_y) * scale;

        switch (stitch.command) {
          case "STITCH":
            if (hasStart) {
              const dx = x - prevX;
              const dy = y - prevY;
              const segLen = Math.sqrt(dx * dx + dy * dy);

              if (segLen >= 0.5) {
                const px = -dy / segLen;
                const py = dx / segLen;
                const c = COLORS[colorIdx % COLORS.length];

                // Shadow
                ctx.beginPath();
                ctx.moveTo(prevX + px * offset, prevY + py * offset);
                ctx.lineTo(x + px * offset, y + py * offset);
                ctx.strokeStyle = `rgb(${(c[0] * 0.6) | 0},${(c[1] * 0.6) | 0},${(c[2] * 0.6) | 0})`;
                ctx.lineWidth = threadWidth;
                ctx.stroke();

                // Main
                ctx.beginPath();
                ctx.moveTo(prevX, prevY);
                ctx.lineTo(x, y);
                ctx.strokeStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
                ctx.lineWidth = threadWidth;
                ctx.stroke();

                // Highlight
                ctx.beginPath();
                ctx.moveTo(prevX - px * offset * 0.4, prevY - py * offset * 0.4);
                ctx.lineTo(x - px * offset * 0.4, y - py * offset * 0.4);
                ctx.strokeStyle = `rgb(${(c[0] + (255 - c[0]) * 0.35) | 0},${(c[1] + (255 - c[1]) * 0.35) | 0},${(c[2] + (255 - c[2]) * 0.35) | 0})`;
                ctx.lineWidth = threadWidth * 0.25;
                ctx.stroke();
              }
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
            renderPatternRef.current = null;
            return;
        }
      }

      currentIndex = endIndex;

      // Continue rendering if more stitches remain
      if (currentIndex < totalStitches) {
        renderPatternRef.current = requestAnimationFrame(renderChunk);
      } else {
        renderPatternRef.current = null;
      }
    };

    // Start the progressive render
    renderPatternRef.current = requestAnimationFrame(renderChunk);
  }, []);

  // Load file into current tab
  const loadFile = useCallback(
    async (filePath: string) => {
      const ext = filePath.toLowerCase().slice(filePath.lastIndexOf("."));
      if (!SUPPORTED_FORMATS.includes(ext)) {
        return;
      }

      const existingTab = tabs.find((t) => t.filePath === filePath);
      if (existingTab) {
        setActiveTabId(existingTab.id);
        return;
      }

      const fileName = filePath.split(/[\\/]/).pop() ?? "Untitled";

      try {
        const pattern = await invoke<Pattern>("load_design", { path: filePath });

        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabId ? { ...t, name: fileName, filePath: filePath, pattern } : t
          )
        );
      } catch (err) {
        console.error(err);
      }
    },
    [activeTabId, tabs]
  );

  // Load file in a new tab
  const loadFileInNewTab = useCallback(
    async (filePath: string, insertIndex?: number) => {
      const ext = filePath.toLowerCase().slice(filePath.lastIndexOf("."));
      if (!SUPPORTED_FORMATS.includes(ext)) {
        return;
      }

      const existingTab = tabs.find((t) => t.filePath === filePath);
      if (existingTab) {
        setActiveTabId(existingTab.id);
        return;
      }

      const newId = Date.now().toString();
      const fileName = filePath.split(/[\\/]/).pop() ?? "Untitled";

      try {
        const pattern = await invoke<Pattern>("load_design", { path: filePath });
        const newTab = { id: newId, name: fileName, filePath: filePath, pattern };

        setTabs((prev) => {
          if (insertIndex !== undefined && insertIndex >= 0 && insertIndex <= prev.length) {
            const newTabs = [...prev];
            newTabs.splice(insertIndex, 0, newTab);
            return newTabs;
          }
          return [...prev, newTab];
        });
        setActiveTabId(newId);
        setTimeout(checkTabsScroll, 100);
      } catch (err) {
        console.error(err);
      }
    },
    [tabs, checkTabsScroll]
  );

  // Open file dialog
  const handleOpenFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Embroidery Files",
          extensions: ["dst", "pes", "exp", "jef", "vp3"],
        },
      ],
    });

    if (selected) {
      void loadFile(selected);
    }
  }, [loadFile]);

  // Render active pattern
  useEffect(() => {
    if (activeTab?.pattern) {
      renderPattern(activeTab.pattern);
    }
  }, [activeTabId, activeTab?.pattern, renderPattern]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "o") {
        e.preventDefault();
        void handleOpenFile();
      }
      if (e.ctrlKey && e.key === "w") {
        e.preventDefault();
        if (tabs.length > 1) {
          closeTab(activeTabId);
        }
      }
      if (e.ctrlKey && e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
        const nextIndex = (currentIndex + 1) % tabs.length;
        setActiveTabId(tabs[nextIndex].id);
      }
      if (e.ctrlKey && e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
        const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        setActiveTabId(tabs[prevIndex].id);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [tabs, activeTabId, closeTab, handleOpenFile]);

  // Listen for drag-drop events
  useEffect(() => {
    const headerHeight = 57;
    const tabWidth = 160;
    const spacing = 6;
    const settingsBtnWidth = 45 + spacing;
    const tabsContainerStart = settingsBtnWidth + spacing;

    const calculateGhostIndex = (x: number): number => {
      const tabsContainer = tabsScrollRef.current;
      if (!tabsContainer) {
        return tabs.length;
      }

      const scrollLeft = tabsContainer.scrollLeft;
      const relativeX = x - tabsContainerStart + scrollLeft;

      const tabSlotWidth = tabWidth + spacing;
      const index = Math.floor((relativeX + tabSlotWidth / 2) / tabSlotWidth);

      return Math.max(0, Math.min(index, tabs.length));
    };

    const unlistenHover = listen<{ paths: string[]; position: { x: number; y: number } }>(
      "tauri://drag-over",
      (e) => {
        if (e.payload.position) {
          if (e.payload.position.y <= headerHeight) {
            setDragZone("header");
            setGhostTabIndex(calculateGhostIndex(e.payload.position.x));
          } else {
            setDragZone("canvas");
            setGhostTabIndex(null);
          }
        }
      }
    );

    const unlistenLeave = listen("tauri://drag-leave", () => {
      setDragZone(null);
      setGhostTabIndex(null);
    });

    const unlistenDrop = listen<{ paths: string[]; position: { x: number; y: number } }>(
      "tauri://drag-drop",
      (e) => {
        const insertIndex = ghostTabIndex;
        setDragZone(null);
        setGhostTabIndex(null);
        if (e.payload.paths?.[0]) {
          if (e.payload.position && e.payload.position.y <= headerHeight) {
            void loadFileInNewTab(e.payload.paths[0], insertIndex ?? undefined);
          } else {
            void loadFile(e.payload.paths[0]);
          }
        }
      }
    );

    return () => {
      void unlistenHover.then((fn) => fn());
      void unlistenLeave.then((fn) => fn());
      void unlistenDrop.then((fn) => fn());
    };
  }, [loadFile, loadFileInNewTab, tabs.length, ghostTabIndex]);

  const showLeftArrow = canScrollLeft;
  const showRightArrow = canScrollRight;

  return (
    <div className="app">
      {/* Title Bar */}
      <div className="title-bar" onMouseDown={handleStartDrag}>
        {/* Left: Settings */}
        <SettingsDialog>
          <button className="title-btn settings-btn" title="Settings">
            <Settings size={20} />
          </button>
        </SettingsDialog>

        {/* Tabs with navigation */}
        <div className="tabs-wrapper">
          {showLeftArrow && (
            <button
              className="tabs-nav-btn tabs-nav-left"
              onClick={() => scrollTabs("left")}
              title="Scroll left"
            >
              <ChevronLeft size={18} />
            </button>
          )}

          <div
            className={`tabs-container ${dragZone === "header" ? "dragging" : ""}`}
            ref={tabsScrollRef}
            onScroll={checkTabsScroll}
            onWheel={(e) => {
              if (e.deltaY !== 0 || e.deltaX !== 0) {
                if (tabsScrollRef.current) {
                  const scrollAmount = e.deltaY !== 0 ? e.deltaY : e.deltaX;
                  tabsScrollRef.current.scrollLeft += scrollAmount;
                  e.preventDefault();
                }
              }
            }}
          >
            {tabs.map((tab, index) => {
              const showTooltip = tab.name.length > 15;
              const tabContent = (
                <div
                  className={`tab ${tab.id === activeTabId ? "active" : ""}`}
                  onClick={() => setActiveTabId(tab.id)}
                  onDoubleClick={handleOpenFile}
                >
                  <span className="tab-name">{tab.name}</span>
                  {tabs.length > 1 && (
                    <button
                      className="tab-close"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }}
                    >
                      <XCircle size={16} />
                    </button>
                  )}
                </div>
              );

              return (
                <React.Fragment key={tab.id}>
                  {ghostTabIndex === index && <div className="ghost-tab">Drop here</div>}
                  {showTooltip ? (
                    <Tooltip>
                      <TooltipTrigger asChild>{tabContent}</TooltipTrigger>
                      <TooltipContent side="bottom">{tab.name}</TooltipContent>
                    </Tooltip>
                  ) : (
                    tabContent
                  )}
                </React.Fragment>
              );
            })}
            {ghostTabIndex === tabs.length && (
              <div key="ghost-end" className="ghost-tab">
                Drop here
              </div>
            )}
            <button className="title-btn add-tab-btn" onClick={addNewTab} title="New Tab">
              <Plus size={20} />
            </button>
          </div>

          {showRightArrow && (
            <button
              className="tabs-nav-btn tabs-nav-right"
              onClick={() => scrollTabs("right")}
              title="Scroll right"
            >
              <ChevronRight size={18} />
            </button>
          )}
        </div>

        {/* Window Controls */}
        <div className="window-controls">
          <button className="title-btn minimize-btn" onClick={handleMinimize} title="Minimize">
            <Minus size={20} />
          </button>
          <button
            className="title-btn"
            onClick={handleMaximize}
            title={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
          </button>
          <button className="title-btn close-btn" onClick={handleClose} title="Close">
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Canvas Area */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={`canvas-area ${dragZone === "canvas" ? "drag-active" : ""}`}
            onDoubleClick={!activeTab?.pattern ? handleOpenFile : undefined}
          >
            {activeTab?.pattern ? (
              <canvas ref={canvasRef} className="design-canvas" />
            ) : (
              <div className="empty-state">
                <FileImage size={64} className="empty-state-icon" />
                <span className="empty-state-title">No File Open</span>
                <span className="empty-state-subtitle">
                  Double-click here or drag and drop an embroidery file to get started
                </span>
                <span className="empty-state-hint">Supported: DST, PES, EXP, JEF, VP3</span>
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onClick={handleOpenFile}>
            <FolderOpen className="mr-2 h-4 w-4" />
            Open File
            <ContextMenuShortcut>Ctrl+O</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled>
            <Info className="mr-2 h-4 w-4" />
            About EmbroCAD
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Status Bar */}
      <footer className="status-bar">
        <div className="status-item">
          <span className="status-label">Stitches:</span>
          <span className="status-value">
            <NumberDisplay
              value={
                activeTab?.pattern?.statistics?.real_stitch_count ??
                activeTab?.pattern?.metadata?.stitch_count ??
                0
              }
            />
          </span>
        </div>
        <div className="status-item">
          <span className="status-label">Colors:</span>
          <span className="status-value">
            <NumberDisplay
              value={
                activeTab?.pattern?.statistics?.color_change_count ??
                activeTab?.pattern?.metadata?.color_count ??
                0
              }
            />
          </span>
        </div>
        <div className="status-item">
          <span className="status-label">Time:</span>
          <span className="status-value">
            <TimeDisplay minutes={activeTab?.pattern?.statistics?.estimated_time_minutes ?? 0} />
          </span>
        </div>
        {activeTab?.pattern?.bounds ? (
          <div className="status-item">
            <span className="status-label">Size:</span>
            <span className="status-value">
              {(
                (activeTab.pattern.bounds.max_x - activeTab.pattern.bounds.min_x) *
                0.1 *
                0.0393701
              ).toFixed(2)}
              &quot; x{" "}
              {(
                (activeTab.pattern.bounds.max_y - activeTab.pattern.bounds.min_y) *
                0.1 *
                0.0393701
              ).toFixed(2)}
              &quot;
            </span>
          </div>
        ) : (
          <div className="status-item">
            <span className="status-label">Size:</span>
            <span className="status-value">0.00&quot; x 0.00&quot;</span>
          </div>
        )}
      </footer>
    </div>
  );
}

export default App;
