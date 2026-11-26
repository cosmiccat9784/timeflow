import { useEffect, useRef, useState } from "react";
import type { Timetable } from "../types";
import { cycleTab, moveTab, unopenedTimetables } from "../tabs";
import { isTauri } from "../native";

/**
 * Chrome/Edge-style window chrome: timetable tabs, dragging, and integrated
 * minimise / maximise / close. The tab order is owned by App so it persists.
 */
export function TitleBar({
  timetables,
  openIds,
  activeId,
  onSwitch,
  onCreate,
  onOpen,
  onClose,
  onReorder,
}: {
  timetables: Timetable[];
  openIds: string[];
  activeId: string;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
  onReorder: (next: string[]) => void;
}) {
  const tauri = isTauri();
  const [addOpen, setAddOpen] = useState(false);
  const [maximised, setMaximised] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const addRef = useRef<HTMLDivElement>(null);

  const tabs = openIds
    .map((id) => timetables.find((t) => t.id === id))
    .filter((t): t is Timetable => Boolean(t));
  const otherTimetables = unopenedTimetables(timetables.map((t) => t.id), { open: openIds, activeId });

  useEffect(() => {
    if (!addOpen) return;
    const onDown = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setAddOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [addOpen]);

  const windowAction = async (action: "min" | "max" | "close") => {
    if (!tauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    if (action === "min") await w.minimize();
    else if (action === "close") await w.close();
    else {
      await w.toggleMaximize();
      setMaximised(await w.isMaximized());
    }
  };

  useEffect(() => {
    if (!tauri) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const w = getCurrentWindow();
      setMaximised(await w.isMaximized());
      unlisten = await w.onResized(async () => setMaximised(await w.isMaximized()));
    })();
    return () => unlisten?.();
  }, [tauri]);

  // Ctrl+Tab cycles tabs, Ctrl+W closes the active one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      if (e.key === "Tab") {
        e.preventDefault();
        const next = cycleTab({ open: openIds, activeId }, e.shiftKey ? -1 : 1);
        if (next.activeId !== activeId) onSwitch(next.activeId);
      } else if (e.key.toLowerCase() === "w") {
        e.preventDefault();
        if (openIds.length > 1) onClose(activeId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIds, activeId, onSwitch, onClose]);

  return (
    <div className={`titlebar${tauri ? " tauri" : ""}`}>
      <div className="titlebar-brand" aria-hidden="true">
        <span className="titlebar-logo">T</span>
      </div>

      <div className="tabstrip" role="tablist" aria-label="Open timetables">
        {tabs.map((t) => (
          <div
            key={t.id}
            role="tab"
            aria-selected={t.id === activeId}
            tabIndex={0}
            className={`tab${t.id === activeId ? " active" : ""}${draggingId === t.id ? " dragging" : ""}`}
            draggable
            onDragStart={() => setDraggingId(t.id)}
            onDragEnd={() => setDraggingId(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (!draggingId) return;
              onReorder(moveTab(openIds, draggingId, t.id));
              setDraggingId(null);
            }}
            onClick={() => onSwitch(t.id)}
            onAuxClick={(e) => { if (e.button === 1) onClose(t.id); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSwitch(t.id); }
              if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onClose(t.id); }
            }}
            title={`${t.name} — ${t.activities.length} activities`}
          >
            <span className="tab-name">{t.name}</span>
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${t.name}`}
              disabled={openIds.length <= 1}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
            >
              ✕
            </button>
          </div>
        ))}

        <div className="tab-add-wrap" ref={addRef}>
          <button
            type="button"
            className="tab-add"
            aria-haspopup="menu"
            aria-expanded={addOpen}
            aria-label="Open a timetable"
            onClick={() => setAddOpen((v) => !v)}
          >
            ＋
          </button>
          {addOpen && (
            <div className="menu tab-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setAddOpen(false); onCreate(); }}>
                ＋ New timetable
              </button>
              {otherTimetables.length > 0 && <hr />}
              {otherTimetables.map((id) => {
                const t = timetables.find((x) => x.id === id)!;
                return (
                  <button type="button" role="menuitem" key={id} onClick={() => { setAddOpen(false); onOpen(id); }}>
                    {t.name} <span className="derived">({t.activities.length})</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="titlebar-drag" data-tauri-drag-region onDoubleClick={() => void windowAction("max")} />
      </div>

      {tauri && (
        <div className="window-controls">
          <button type="button" className="wc" aria-label="Minimise" onClick={() => void windowAction("min")}>—</button>
          <button type="button" className="wc" aria-label={maximised ? "Restore" : "Maximise"} onClick={() => void windowAction("max")}>
            {maximised ? "❐" : "□"}
          </button>
          <button type="button" className="wc close" aria-label="Close" onClick={() => void windowAction("close")}>✕</button>
        </div>
      )}
    </div>
  );
}
