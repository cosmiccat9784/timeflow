import { useEffect, useRef } from "react";
import type { Category, Weekday } from "../types";
import { WEEKDAY_NAMES } from "../types";
import type { MergedBlock } from "../merge";

export interface MenuState {
  x: number;
  y: number;
  block: MergedBlock;
}

/**
 * Category context menu — spec §9.2.
 * Lists all categories (current highlighted) + Edit / Split / Duplicate /
 * Delete / Swap. Opens near activity, closes on outside click + Escape,
 * keyboard navigable, touch usable.
 */
export function CategoryMenu({
  menu,
  categories,
  onSelectCategory,
  onEdit,
  onSplit,
  onDuplicate,
  onDelete,
  onSwap,
  onClose,
}: {
  menu: MenuState;
  categories: Category[];
  onSelectCategory: (categoryId: string) => void;
  onEdit: () => void;
  onSplit: (() => void) | null;
  onDuplicate: () => void;
  onDelete: () => void;
  onSwap: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const current = menu.block.members[0].categoryId;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Keep inside window (§9.2).
    const r = el.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (r.right > window.innerWidth - 8) dx = window.innerWidth - 8 - r.right;
    if (r.bottom > window.innerHeight - 8) dy = window.innerHeight - 8 - r.bottom;
    if (dx !== 0 || dy !== 0) el.style.transform = `translate(${dx}px, ${dy}px)`;
    // Focus first item for keyboard users.
    const first = el.querySelector<HTMLButtonElement>("button");
    first?.focus();
  }, []);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      aria-label="Activity actions and categories"
      style={{ left: menu.x, top: menu.y }}
    >
      <h4>Category</h4>
      {categories.map((c) => (
        <button
          key={c.id}
          type="button"
          role="menuitemradio"
          aria-checked={c.id === current}
          className={c.id === current ? "current" : ""}
          onClick={() => onSelectCategory(c.id)}
        >
          <span className="swatch" style={{ background: c.colour }} aria-hidden="true" />
          <span aria-hidden="true">{c.icon}</span>
          <span>{c.name}{c.id === current ? " ✓" : ""}</span>
        </button>
      ))}
      <hr />
      <button type="button" role="menuitem" onClick={onEdit}>✏️ Edit… (Enter)</button>
      {onSplit && (
        <button type="button" role="menuitem" onClick={onSplit}>
          ✂️ Split block ({menu.block.members.length} parts)
        </button>
      )}
      <button type="button" role="menuitem" onClick={onDuplicate}>⧉ Duplicate</button>
      <button type="button" role="menuitem" onClick={onSwap}>⇄ Swap with another…</button>
      <button type="button" role="menuitem" onClick={onDelete}>🗑 Delete</button>
    </div>
  );
}

/** Right-click / long-press on empty time: create here. */
export function EmptyMenu({
  x,
  y,
  day,
  timeLabel,
  onNew,
  onClose,
}: {
  x: number;
  y: number;
  day: Weekday;
  timeLabel: string;
  onNew: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (r.right > window.innerWidth - 8) dx = window.innerWidth - 8 - r.right;
    if (r.bottom > window.innerHeight - 8) dy = window.innerHeight - 8 - r.bottom;
    if (dx !== 0 || dy !== 0) el.style.transform = `translate(${dx}px, ${dy}px)`;
    el.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      aria-label={`Actions for empty time on ${WEEKDAY_NAMES[day]}`}
      style={{ left: x, top: y }}
    >
      <h4>{WEEKDAY_NAMES[day]} · {timeLabel}</h4>
      <button type="button" role="menuitem" onClick={onNew}>＋ New activity here</button>
    </div>
  );
}
