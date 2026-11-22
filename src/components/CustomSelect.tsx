import { useEffect, useMemo, useRef, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Dark listbox used everywhere instead of a native <select>.
 * Keyboard: Enter/Space/ArrowDown opens, Arrow keys move, Home/End jump,
 * Enter/Space commits, Escape closes, printable keys type-ahead.
 */
export function CustomSelect({
  id,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  id?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const selected = options.find((o) => o.value === value);
  const selectedIndex = useMemo(() => Math.max(0, options.findIndex((o) => o.value === value)), [options, value]);

  const openList = () => {
    setActive(selectedIndex);
    setOpen(true);
  };

  const commit = (index: number) => {
    const o = options[index];
    if (!o) return;
    onChange(o.value);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    setActive(selectedIndex);
    // Focus the list so keyboard events land here rather than the page.
    listRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => (i + 1) % Math.max(1, options.length));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => (i - 1 + options.length) % Math.max(1, options.length));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(Math.max(0, options.length - 1));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(active);
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        ref.current?.querySelector<HTMLElement>(".custom-select-trigger")?.focus();
        break;
      case "Tab":
        setOpen(false);
        break;
      default: {
        // Type-ahead: jump to the next option starting with the typed run.
        if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
        const now = Date.now();
        const prev = typeahead.current;
        const text = (now - prev.at < 700 ? prev.text : "") + e.key.toLowerCase();
        typeahead.current = { text, at: now };
        const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(text));
        if (hit >= 0) {
          e.preventDefault();
          setActive(hit);
        }
      }
    }
  };

  return (
    <div className="custom-select" ref={ref}>
      <button
        type="button"
        id={id}
        className="custom-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            openList();
          }
        }}
      >
        <span>{selected?.label ?? value}</span>
        <span aria-hidden="true" className="custom-select-arrow">▾</span>
      </button>
      {open && (
        <div
          className="custom-select-list"
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
          ref={listRef}
          onKeyDown={onListKeyDown}
        >
          {options.map((o, i) => (
            <button
              key={o.value}
              type="button"
              role="option"
              data-index={i}
              aria-selected={o.value === value}
              className={`${o.value === value ? "current" : ""}${i === active ? " active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => commit(i)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
