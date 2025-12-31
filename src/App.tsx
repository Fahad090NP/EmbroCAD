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
} from "lucide-react";
import { config } from "./config/config";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/ui/tooltip";
import { SettingsDialog } from "./components/settings-dialog";
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

interface Tab {
  id: string;
  name: string;
  filePath: string | null;
  pattern: Pattern | null;
}

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

  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.5) {
    return;
  }

  const px = -dy / len;
  const py = dx / len;

  const main = `rgb(${color.r}, ${color.g}, ${color.b})`;
  const shadow = darkenColor(color.r, color.g, color.b, 0.6);
  const highlight = lightenColor(color.r, color.g, color.b, 0.35);

  const offset = threadWidth * 0.25;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(x1 + px * offset, y1 + py * offset);
  ctx.lineTo(x2 + px * offset, y2 + py * offset);
  ctx.strokeStyle = shadow;
  ctx.lineWidth = threadWidth;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = main;
  ctx.lineWidth = threadWidth;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x1 - px * offset * 0.4, y1 - py * offset * 0.4);
  ctx.lineTo(x2 - px * offset * 0.4, y2 - py * offset * 0.4);
  ctx.strokeStyle = highlight;
  ctx.lineWidth = threadWidth * 0.25;
  ctx.stroke();
};

function App() {
  const [tabs, setTabs] = useState<Tab[]>([
    { id: "1", name: "Empty", filePath: null, pattern: null },
  ]);
  const [activeTabId, setActiveTabId] = useState("1");
  const [isLoading, setIsLoading] = useState(false);
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
    // Only drag on the drag region itself, not on buttons or tabs
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest(".tab")) {
      return;
    }
    await getCurrentWindow().startDragging();
  };

  // Tab operations
  const addNewTab = useCallback(() => {
    // Check if there's already an empty tab
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

  // Render pattern to canvas
  const renderPattern = useCallback((pattern: Pattern) => {
    const canvas = canvasRef.current;
    if (!canvas || !pattern.bounds) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
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

    canvas.width = patternWidth * scale;
    canvas.height = patternHeight * scale;

    ctx.fillStyle =
      getComputedStyle(document.documentElement).getPropertyValue("--canvas-bg").trim() ||
      "#1A1A1A";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const tx = (x: number) => (x - min_x) * scale;
    const ty = (y: number) => (y - min_y) * scale;

    const { width, minWidth, maxWidth } = config.thread;
    const threadWidth = Math.max(minWidth, Math.min(maxWidth, scale * width * 0.4));

    let colorIdx = 0;
    let prevX = 0;
    let prevY = 0;
    let hasStart = false;

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

  // Load file into current tab (replaces current tab content)
  const loadFile = useCallback(
    async (filePath: string) => {
      const ext = filePath.toLowerCase().slice(filePath.lastIndexOf("."));
      if (!(config.formats.supported as readonly string[]).includes(ext)) {
        return;
      }

      // Check if file is already open in a tab
      const existingTab = tabs.find((t) => t.filePath === filePath);
      if (existingTab) {
        setActiveTabId(existingTab.id);
        return;
      }

      setIsLoading(true);
      const fileName = filePath.split(/[\\/]/).pop() ?? "Untitled";

      try {
        const result = await invoke<Pattern>("parse_dst_file", { path: filePath });

        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabId ? { ...t, name: fileName, filePath: filePath, pattern: result } : t
          )
        );
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    },
    [activeTabId, tabs]
  );

  // Load file in a new tab at specified position
  const loadFileInNewTab = useCallback(
    async (filePath: string, insertIndex?: number) => {
      const ext = filePath.toLowerCase().slice(filePath.lastIndexOf("."));
      if (!(config.formats.supported as readonly string[]).includes(ext)) {
        return;
      }

      // Check if file is already open in a tab
      const existingTab = tabs.find((t) => t.filePath === filePath);
      if (existingTab) {
        setActiveTabId(existingTab.id);
        return;
      }

      const newId = Date.now().toString();
      const fileName = filePath.split(/[\\/]/).pop() ?? "Untitled";

      setIsLoading(true);

      try {
        const result = await invoke<Pattern>("parse_dst_file", { path: filePath });
        const newTab = { id: newId, name: fileName, filePath: filePath, pattern: result };

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
      } finally {
        setIsLoading(false);
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
      // Ctrl+O - Open file
      if (e.ctrlKey && e.key === "o") {
        e.preventDefault();
        void handleOpenFile();
      }
      // Ctrl+W - Close current tab
      if (e.ctrlKey && e.key === "w") {
        e.preventDefault();
        if (tabs.length > 1) {
          closeTab(activeTabId);
        }
      }
      // Ctrl+Tab - Next tab
      if (e.ctrlKey && e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
        const nextIndex = (currentIndex + 1) % tabs.length;
        setActiveTabId(tabs[nextIndex].id);
      }
      // Ctrl+Shift+Tab - Previous tab
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
    const headerHeight = 57; // 6px padding + 45px header + 6px gap
    const tabWidth = 160; // --tab-width
    const spacing = 6; // --spacing
    const settingsBtnWidth = 45 + spacing; // Settings button + gap
    const tabsContainerStart = settingsBtnWidth + spacing; // Start of tabs area

    // Calculate which tab position the cursor is over
    const calculateGhostIndex = (x: number): number => {
      const tabsContainer = tabsScrollRef.current;
      if (!tabsContainer) {
        return tabs.length;
      }

      const scrollLeft = tabsContainer.scrollLeft;
      const relativeX = x - tabsContainerStart + scrollLeft;

      // Each tab takes tabWidth + spacing
      const tabSlotWidth = tabWidth + spacing;
      const index = Math.floor((relativeX + tabSlotWidth / 2) / tabSlotWidth);

      // Clamp to valid range
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
            // Dropped on header - create new tab at position
            void loadFileInNewTab(e.payload.paths[0], insertIndex ?? undefined);
          } else {
            // Dropped on canvas - replace current tab
            void loadFile(e.payload.paths[0]);
          }
        }
      }
    );

    return () => {
      void unlistenHover.then((fn) => {
        fn();
      });
      void unlistenLeave.then((fn) => {
        fn();
      });
      void unlistenDrop.then((fn) => {
        fn();
      });
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
              onClick={() => {
                scrollTabs("left");
              }}
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
              // Enable horizontal scrolling with both regular wheel and shift+wheel
              if (e.deltaY !== 0 || e.deltaX !== 0) {
                if (tabsScrollRef.current) {
                  // If shift is pressed, browser usually handles horizontal scroll,
                  // but we want to ensure it works smoothly or force it if desired.
                  // For "mouse-wheel only", we translate Y to X.

                  // Use deltaY for horizontal scroll if shift is NOT pressed (standard vertical-to-horizontal mapping for this UI)
                  // If shift IS pressed, deltaX is usually populated by browser, or we use deltaY if deltaX is 0.

                  const scrollAmount = e.deltaY !== 0 ? e.deltaY : e.deltaX;
                  tabsScrollRef.current.scrollLeft += scrollAmount;
                  e.preventDefault(); // Prevent page scroll
                }
              }
            }}
          >
            {tabs.map((tab, index) => {
              const showTooltip = tab.name.length > 15;
              const tabContent = (
                <div
                  className={`tab ${tab.id === activeTabId ? "active" : ""}`}
                  onClick={() => {
                    setActiveTabId(tab.id);
                  }}
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
              onClick={() => {
                scrollTabs("right");
              }}
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
      <div
        className={`canvas-area ${dragZone === "canvas" ? "drag-active" : ""}`}
        onDoubleClick={!activeTab?.pattern ? handleOpenFile : undefined}
      >
        {isLoading ? (
          <div className="loading-state">
            <div className="spinner" />
            <span className="loading-text">Loading embroidery file...</span>
          </div>
        ) : activeTab?.pattern ? (
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
    </div>
  );
}

export default App;
