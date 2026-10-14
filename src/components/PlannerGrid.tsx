import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import type { Category, ClockFormat, GlobalSettings, Weekday } from "../types";
import { WEEKDAY_NAMES, WEEKDAY_SHORT, displayName } from "../types";
import { SLOT, clampDay, formatDuration, formatTime, snapToSlot } from "../time";
import type { MergedBlock } from "../merge";

const MIN_SLOT_H = 14; // px per 15-min row before scrolling kicks in
const MAX_SLOT_H = 64; // cap so ultrawide/tall screens stay readable
const MOVE_THRESHOLD_PX = 6;
const LONG_PRESS_MS = 500;
const TOUCH_DRAG_HOLD_MS = 250;

export interface MenuRequest {
  x: number;
  y: number;
  block: MergedBlock;
}

export interface EmptySlotRequest {
  x: number;
  y: number;
  day: Weekday;
  start: number;
}

interface PreviewMove { kind: "move"; day: Weekday; start: number }
interface PreviewResize { kind: "resize"; edge: "top" | "bottom"; time: number }
interface PreviewCreate { kind: "create"; day: Weekday; start: number; end: number }
type Preview = PreviewMove | PreviewResize | PreviewCreate | null;

function inSwitchPair(block: MergedBlock, settings: GlobalSettings): boolean {
  const c = block.members[0].categoryId;
  return settings.switchPair.includes(c);
}

function catOf(categories: Category[], id: string): Category | undefined {
  return categories.find((c) => c.id === id);
}

/**
 * Weekly/daily scheduling grid — spec §4, §5, §9, §10.
 * Owns the pointer state machine (click vs drag vs long-press vs resize)
 * so gestures never interfere with each other.
 */
export function PlannerGrid({
  blocks,
  categories,
  settings,
  clockFormat,
  view,
  visibleDay,
  today,
  nowMinutes,
  selectedBlockKey,
  conflictIds,
  lanesByDay,
  dayMinutes,
  swapArmed,
  completedIds,
  timerActivityId,
  onQuickSwitch,
  onSelectBlock,
  onOpenMenu,
  onEmptyMenu,
  onCreate,
  onCommitMove,
  onCommitResize,
  onEditBlock,
  onDeleteBlock,
  onSwapTarget,
  onChangeDay,
}: {
  blocks: MergedBlock[];
  categories: Category[];
  settings: GlobalSettings;
  clockFormat: ClockFormat;
  view: "week" | "day";
  visibleDay: Weekday;
  today: Weekday;
  nowMinutes: number;
  selectedBlockKey: string | null;
  conflictIds: Set<string>;
  lanesByDay: Map<number, Map<string, { lane: number; lanes: number }>>;
  dayMinutes: Record<number, { study: number; optionalWork: number }>;
  swapArmed: boolean;
  completedIds: Set<string>;
  timerActivityId: string | null;
  onQuickSwitch: (block: MergedBlock) => void;
  onSelectBlock: (key: string | null) => void;
  onOpenMenu: (m: MenuRequest) => void;
  onEmptyMenu: (m: EmptySlotRequest) => void;
  onCreate: (day: Weekday, start: number, end: number) => void;
  onCommitMove: (blockKey: string, day: Weekday, start: number) => void;
  onCommitResize: (blockKey: string, edge: "top" | "bottom", time: number) => void;
  onEditBlock: (block: MergedBlock) => void;
  onDeleteBlock: (block: MergedBlock) => void;
  onSwapTarget: (block: MergedBlock) => void;
  onChangeDay: (day: Weekday) => void;
}) {
  const visStart = settings.visibleStartMinutes;
  const visEnd = settings.visibleEndMinutes;
  const slots = Math.max(1, Math.round((visEnd - visStart) / SLOT));
  const [slotH, setSlotH] = useState(MIN_SLOT_H);
  const colH = slots * slotH;
  const days: Weekday[] = view === "week" ? [0, 1, 2, 3, 4, 5, 6] : [visibleDay];

  const colRefs = useRef(new Map<number, HTMLDivElement>());
  const gridRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<Preview>(null);
  const [kbMove, setKbMove] = useState<{ key: string; day: Weekday; start: number } | null>(null);
  const lastTap = useRef<{ key: string; at: number } | null>(null);
  const press = useRef<{
    kind: "empty" | "block";
    day: Weekday;
    anchorStart: number;
    blockKey: string | null;
    edge: "top" | "bottom" | null;
    pointerId: number;
    pointerType: string;
    startX: number;
    startY: number;
    downAt: number;
    moved: boolean;
    dragging: boolean;
    grabOffset: number;
    menuFired: boolean;
    timer?: ReturnType<typeof setTimeout>;
  } | null>(null);

  const blocksByDay = useMemo(() => {
    const m = new Map<number, MergedBlock[]>();
    for (const b of blocks) {
      if (!m.has(b.weekday)) m.set(b.weekday, []);
      m.get(b.weekday)!.push(b);
    }
    return m;
  }, [blocks]);

  const blockByKey = useMemo(() => new Map(blocks.map((b) => [b.key, b])), [blocks]);

  const clearTimer = () => {
    if (press.current?.timer) clearTimeout(press.current.timer);
  };

  const minutesAtClientY = (day: Weekday, clientY: number): number => {
    const el = colRefs.current.get(day);
    if (!el) return visStart;
    const r = el.getBoundingClientRect();
    return visStart + ((clientY - r.top) / slotH) * SLOT;
  };

  const dayAtClientX = (clientX: number, fallback: Weekday): Weekday => {
    for (const [d, el] of colRefs.current) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right) return d as Weekday;
    }
    return fallback;
  };

  const fireMenu = (clientX: number, clientY: number, block: MergedBlock) => {
    if (press.current) press.current.menuFired = true;
    onOpenMenu({ x: Math.min(clientX, window.innerWidth - 260), y: Math.min(clientY, window.innerHeight - 320), block });
  };

  const fireEmptyMenu = (clientX: number, clientY: number, day: Weekday, start: number) => {
    if (press.current) press.current.menuFired = true;
    onEmptyMenu({ x: Math.min(clientX, window.innerWidth - 260), y: Math.min(clientY, window.innerHeight - 140), day, start });
  };

  // Stretch rows so the visible range always fills the window height;
  // fall back to scrolling once rows would get shorter than the minimum.
  useLayoutEffect(() => {
    const measure = () => {
      const grid = gridRef.current;
      const parent = grid?.parentElement;
      if (!grid || !parent) return;
      const head = grid.querySelector(".day-head") as HTMLElement | null;
      const headH = head ? head.getBoundingClientRect().height : 48;
      const avail = parent.clientHeight - headH - 28;
      const ideal = Math.floor(avail / slots);
      setSlotH(Math.max(MIN_SLOT_H, Math.min(MAX_SLOT_H, ideal || MIN_SLOT_H)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [slots, view]);

  // ---------- pointer handlers (delegated on container) ----------

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only primary button / touch / pen.
    if (e.pointerType === "mouse" && e.button === 2) return; // right-click handled separately
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const blockEl = (e.target as HTMLElement).closest<HTMLElement>("[data-block]");
    const colEl = (e.target as HTMLElement).closest<HTMLElement>("[data-day]");
    if (!colEl) return;
    const day = Number(colEl.dataset.day) as Weekday;
    e.currentTarget.setPointerCapture?.(e.pointerId);

    if (blockEl) {
      const key = blockEl.dataset.block!;
      const block = blockByKey.get(key);
      if (!block) return;
      const handleEl = (e.target as HTMLElement).closest<HTMLElement>("[data-edge]");
      const edge = (handleEl?.dataset.edge as "top" | "bottom" | undefined) ?? null;
      const pointerMin = minutesAtClientY(day, e.clientY);
      press.current = {
        kind: "block", day, anchorStart: block.startTime, blockKey: key, edge,
        pointerId: e.pointerId, pointerType: e.pointerType,
        startX: e.clientX, startY: e.clientY, downAt: Date.now(),
        moved: false, dragging: edge !== null, // resize engages immediately
        grabOffset: Math.max(0, pointerMin - block.startTime),
        menuFired: false,
      };
      if (edge === null) {
        // Long-press (500ms) opens category menu without right-click (§9.1).
        const cx = e.clientX;
        const cy = e.clientY;
        press.current.timer = setTimeout(() => {
          if (press.current && !press.current.moved && !press.current.menuFired) {
            fireMenu(cx, cy, block);
          }
        }, LONG_PRESS_MS);
      }
    } else {
      const start = clampDay(snapToSlot(minutesAtClientY(day, e.clientY)));
      press.current = {
        kind: "empty", day, anchorStart: start, blockKey: null, edge: null,
        pointerId: e.pointerId, pointerType: e.pointerType,
        startX: e.clientX, startY: e.clientY, downAt: Date.now(),
        moved: false, dragging: false, grabOffset: 0, menuFired: false,
      };
      // Long-press on empty time opens the New-activity menu (§9.1).
      const cx = e.clientX;
      const cy = e.clientY;
      press.current.timer = setTimeout(() => {
        if (press.current && !press.current.moved && !press.current.menuFired) {
          fireEmptyMenu(cx, cy, day, start);
        }
      }, LONG_PRESS_MS);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    const dist = Math.hypot(e.clientX - p.startX, e.clientY - p.startY);
    if (dist > MOVE_THRESHOLD_PX) {
      p.moved = true;
      clearTimer();
    }
    if (!p.moved) return;
    // Touch drag engages after a short hold so scrolling still works (§9.3).
    if (p.pointerType === "touch" && p.edge === null && Date.now() - p.downAt < TOUCH_DRAG_HOLD_MS) return;
    p.dragging = true;

    if (p.kind === "empty") {
      const cur = clampDay(snapToSlot(minutesAtClientY(p.day, e.clientY)));
      const start = Math.min(p.anchorStart, cur);
      const end = Math.max(p.anchorStart, cur) + SLOT;
      setPreview({ kind: "create", day: p.day, start, end: Math.min(end, 1440) });
    } else if (p.blockKey) {
      const block = blockByKey.get(p.blockKey);
      if (!block) return;
      if (p.edge) {
        const t = clampDay(snapToSlot(minutesAtClientY(p.day, e.clientY)));
        setPreview({ kind: "resize", edge: p.edge, time: t });
      } else {
        const day = dayAtClientX(e.clientX, p.day);
        const dur = block.endTime - block.startTime;
        let start = snapToSlot(minutesAtClientY(day, e.clientY) - p.grabOffset);
        start = Math.max(0, Math.min(1440 - dur, start));
        setPreview({ kind: "move", day, start });
      }
    }
  };

  const endPress = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    clearTimer();
    press.current = null;
    if (cancelled || p.menuFired) {
      setPreview(null);
      return;
    }
    if (p.kind === "empty") {
      if (!p.moved) {
        // Simple click → 60-min creation popover at clicked slot (§6.2).
        const end = Math.min(p.anchorStart + 60, 1440);
        if (end - p.anchorStart >= 15) onCreate(p.day, p.anchorStart, end);
      } else if (preview?.kind === "create") {
        const { day, start, end } = preview;
        setPreview(null);
        if (end - start >= 15) onCreate(day, start, Math.min(end, 1440));
        return;
      }
      setPreview(null);
      return;
    }
    // Block gesture.
    const block = p.blockKey ? blockByKey.get(p.blockKey) : undefined;
    if (!block) {
      setPreview(null);
      return;
    }
    if (p.dragging && preview) {
      if (preview.kind === "move") onCommitMove(block.key, preview.day, preview.start);
      else if (preview.kind === "resize") onCommitResize(block.key, preview.edge, preview.time);
      setPreview(null);
      return;
    }
    setPreview(null);
    if (p.moved) return; // drag that snapped back — no click action.
    // Single click / tap selects. Double-click switches the pair (§7.3).
    if (swapArmed) {
      onSwapTarget(block);
      return;
    }
    const now = Date.now();
    if (lastTap.current?.key === block.key && now - lastTap.current.at < 400) {
      lastTap.current = null;
      if (inSwitchPair(block, settings)) onQuickSwitch(block);
      else onSelectBlock(block.key);
    } else {
      lastTap.current = { key: block.key, at: now };
      onSelectBlock(block.key);
    }
  };

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    const blockEl = (e.target as HTMLElement).closest<HTMLElement>("[data-block]");
    if (!blockEl) {
      // Right-click on empty time offers creation directly.
      const colEl = (e.target as HTMLElement).closest<HTMLElement>("[data-day]");
      if (!colEl) return;
      e.preventDefault();
      const day = Number(colEl.dataset.day) as Weekday;
      const start = clampDay(snapToSlot(minutesAtClientY(day, e.clientY)));
      clearTimer();
      press.current = null;
      setPreview(null);
      fireEmptyMenu(e.clientX, e.clientY, day, start);
      return;
    }
    e.preventDefault();
    const block = blockByKey.get(blockEl.dataset.block!);
    if (block) {
      clearTimer();
      press.current = null;
      setPreview(null);
      fireMenu(e.clientX, e.clientY, block);
    }
  };

  // ---------- keyboard ----------

  const focusBlock = (day: Weekday, index: number) => {
    const list = blocksByDay.get(day) ?? [];
    const b = list[Math.max(0, Math.min(list.length - 1, index))];
    if (!b) return;
    document.querySelector<HTMLElement>(`[data-block="${b.key}"] button[data-focus-target]`)?.focus();
  };

  const onBlockKeyDown = (e: React.KeyboardEvent, block: MergedBlock, index: number) => {
    if (kbMove?.key === block.key) {
      const dur = block.endTime - block.startTime;
      let { day, start } = kbMove;
      if (e.key === "ArrowUp") { start = Math.max(0, start - SLOT); e.preventDefault(); }
      else if (e.key === "ArrowDown") { start = Math.min(1440 - dur, start + SLOT); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { day = ((day + 6) % 7) as Weekday; e.preventDefault(); }
      else if (e.key === "ArrowRight") { day = ((day + 1) % 7) as Weekday; e.preventDefault(); }
      else if (e.key === "Enter") { setKbMove(null); onCommitMove(block.key, day, start); e.preventDefault(); return; }
      else if (e.key === "Escape") { setKbMove(null); setPreview(null); e.preventDefault(); return; }
      else return;
      setKbMove({ key: block.key, day, start });
      setPreview({ kind: "move", day, start });
      return;
    }
    switch (e.key) {
      case "Enter":
        e.preventDefault();
        if (swapArmed) onSwapTarget(block);
        else onEditBlock(block);
        break;
      case "s":
      case "S":
        // Keyboard quick-switch for the configured pair.
        e.preventDefault();
        if (!swapArmed && inSwitchPair(block, settings)) onQuickSwitch(block);
        break;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        onDeleteBlock(block);
        break;
      case "F10":
        if (e.shiftKey) {
          e.preventDefault();
          const r = (e.target as HTMLElement).getBoundingClientRect();
          fireMenu(r.left, r.bottom, block);
        }
        break;
      case "ContextMenu":
        e.preventDefault();
        {
          const r = (e.target as HTMLElement).getBoundingClientRect();
          fireMenu(r.left, r.bottom, block);
        }
        break;
      case "m":
      case "M":
        // Keyboard move mode — non-drag alternative (§9.7).
        e.preventDefault();
        setKbMove({ key: block.key, day: block.weekday, start: block.startTime });
        setPreview({ kind: "move", day: block.weekday, start: block.startTime });
        break;
      case "ArrowUp":
      case "ArrowDown": {
        e.preventDefault();
        const list = blocksByDay.get(block.weekday) ?? [];
        const i = list.findIndex((b) => b.key === block.key);
        focusBlock(block.weekday, i + (e.key === "ArrowUp" ? -1 : 1));
        break;
      }
      case "ArrowLeft":
      case "ArrowRight": {
        e.preventDefault();
        const d = ((block.weekday + (e.key === "ArrowLeft" ? 6 : 1)) % 7) as Weekday;
        onChangeDay(d);
        setTimeout(() => focusBlock(d, index), 30);
        break;
      }
    }
  };

  // ---------- render ----------

  const hourLabels: number[] = [];
  for (let t = Math.ceil(visStart / 60) * 60; t < visEnd; t += 60) hourLabels.push(t);

  const renderBlock = (b: MergedBlock, dayIdx: number) => {
    const first = b.members[0];
    const label = displayName(first, categories);
    const cat = catOf(categories, first.categoryId);
    const effStart = kbMove?.key === b.key && preview?.kind === "move" ? preview.start : b.startTime;
    const effDay = kbMove?.key === b.key && preview?.kind === "move" ? preview.day : b.weekday;
    if (effDay !== days[dayIdx]) return null;
    const top = ((effStart - visStart) / SLOT) * slotH;
    const h = Math.max(20, ((b.endTime - b.startTime) / SLOT) * slotH - 2);
    const lanes = lanesByDay.get(b.weekday)?.get(first.id);
    const widthPct = lanes ? 100 / lanes.lanes : 100;
    const leftPct = lanes ? (lanes.lane * 100) / lanes.lanes : 0;
    const hasConflict = b.members.some((m) => conflictIds.has(m.id));
    const isDone = b.members.every((m) => completedIds.has(m.id));
    const hasTimer = b.members.some((m) => m.id === timerActivityId);
    const isSelected = selectedBlockKey === b.key || kbMove?.key === b.key;
    return (
      <div
        key={b.key}
        data-block={b.key}
        className={`block${b.members.length > 1 ? " merged" : ""}${hasConflict ? " conflict" : ""}${isSelected ? " selected" : ""}${isDone ? " done" : ""}`}
        style={{
          top,
          height: h,
          background: cat?.colour ?? "#eee",
          left: `calc(${leftPct}% + 3px)`,
          width: `calc(${widthPct}% - 6px)`,
        }}
        role="group"
        aria-label={`${label}, ${WEEKDAY_NAMES[b.weekday]} ${formatTime(b.startTime, clockFormat)} to ${formatTime(b.endTime, clockFormat)}, ${cat?.name ?? "unknown category"}${hasConflict ? ", scheduling conflict" : ""}${b.members.length > 1 ? `, merged block of ${b.members.length}` : ""}`}
      >
        <div className="resize-handle top" data-edge="top" aria-hidden="true" />
        <button
          type="button"
          data-focus-target
          onKeyDown={(e) => onBlockKeyDown(e, b, blocksByDay.get(b.weekday)?.findIndex((x) => x.key === b.key) ?? 0)}
          aria-label={`${label}. Press Enter to edit. Press S to switch category. Press M to move with keyboard.`}
          style={{ all: "unset", display: "block", width: "100%", cursor: "pointer", touchAction: "none" } as React.CSSProperties}
        >
          <span className="bname">
            <span className="bicon" aria-hidden="true">{cat?.icon}</span>
            {label}
            {isDone && <span className="done-badge" title="Marked complete">✓</span>}
            {hasTimer && <span className="done-badge" title="Timer running">⏱</span>}
            {hasConflict && <span className="conflict-dot" title="Scheduling conflict">⚠ overlap</span>}
          </span>
          {h > 34 && (
            <span className="bmeta">
              {formatTime(b.startTime, clockFormat)}–{formatTime(b.endTime, clockFormat)} · {formatDuration(b.endTime - b.startTime)}
            </span>
          )}
          {b.members.length > 1 && h > 50 && (
            <span className="bmerge">×{b.members.length} merged — switches together</span>
          )}
        </button>
        {b.members.length > 1 &&
          b.members.slice(1).map((m) => (
            <div
              key={m.id}
              className="member-divider"
              style={{ position: "absolute", left: 6, right: 6, top: ((m.startTime - b.startTime) / SLOT) * slotH }}
              aria-hidden="true"
            />
          ))}
        <div className="resize-handle bottom" data-edge="bottom" aria-hidden="true" />
      </div>
    );
  };

  const previewOverlay = (day: Weekday) => {
    if (!preview) return null;
    if (preview.kind === "create" && preview.day === day) {
      const top = ((preview.start - visStart) / SLOT) * slotH;
      const h = Math.max(slotH, ((preview.end - preview.start) / SLOT) * slotH);
      return (
        <div className="create-preview" style={{ top, height: h }} aria-hidden="true">
          {formatTime(preview.start, clockFormat)}–{formatTime(preview.end, clockFormat)}
        </div>
      );
    }
    if (preview.kind === "move" && preview.day === day) {
      // Height comes from the moving block; find it.
      const movingKey = press.current?.blockKey ?? kbMove?.key;
      const moving = movingKey ? blockByKey.get(movingKey) : undefined;
      const dur = moving ? moving.endTime - moving.startTime : 60;
      const top = ((preview.start - visStart) / SLOT) * slotH;
      const h = Math.max(20, (dur / SLOT) * slotH - 2);
      return (
        <div className="drag-preview" style={{ top, height: h }} aria-hidden="true">
          {WEEKDAY_SHORT[day]} {formatTime(preview.start, clockFormat)}
        </div>
      );
    }
    return null;
  };

  return (
    <div
      className="grid"
      ref={gridRef}
      role="grid"
      aria-label="Weekly timetable"
      style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPress(e, false)}
      onPointerCancel={(e) => endPress(e, true)}
      onContextMenu={onContextMenu}
    >
      <div className="grid-header" role="row">
        <div className="corner" />
        {days.map((d) => (
          <div key={d} className={`day-head${d === today ? " today" : ""}`} role="columnheader" aria-label={WEEKDAY_NAMES[d]}>
            <div className="dname">{WEEKDAY_NAMES[d]}{d === today ? " •" : ""}</div>
            <div className="dtotal">
              📚 {formatDuration(dayMinutes[d].study)}
              {dayMinutes[d].optionalWork > 0 && ` · 💼 ${formatDuration(dayMinutes[d].optionalWork)}`}
            </div>
          </div>
        ))}
      </div>
      <div className="time-gutter" aria-hidden="true" style={{ position: "relative" }}>
        {hourLabels.map((t) => (
          <div key={t} className="time-label" style={{ position: "absolute", top: ((t - visStart) / SLOT) * slotH, height: slotH * 4, width: "100%" }}>
            {formatTime(t, clockFormat)}
          </div>
        ))}
        <div style={{ height: colH }} />
      </div>
      {days.map((d, di) => (
        <div
          key={d}
          data-day={d}
          ref={(el) => { if (el) colRefs.current.set(d, el); else colRefs.current.delete(d); }}
          className={`day-col${d === today ? " today" : ""}`}
          style={{ height: colH }}
          role="gridcell"
          aria-label={`${WEEKDAY_NAMES[d]} schedule`}
        >
          {Array.from({ length: slots }, (_, i) => (
            <div key={i} className={`slot-line${i % 4 === 0 ? " hour" : ""}`} style={{ height: slotH }} aria-hidden="true" />
          ))}
          {d === today && nowMinutes >= visStart && nowMinutes < visEnd && (
            <div
              className="now-line"
              style={{ top: ((nowMinutes - visStart) / SLOT) * slotH }}
              role="presentation"
              aria-hidden="true"
            />
          )}
          {(blocksByDay.get(d) ?? []).map((b) => renderBlock(b, di))}
          {previewOverlay(d)}
          {/* hidden live description of preview position */}
          <span className="sr-only" aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
            {preview?.kind === "move" ? `Moving to ${WEEKDAY_NAMES[preview.day]} ${formatTime(preview.start, clockFormat)}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

