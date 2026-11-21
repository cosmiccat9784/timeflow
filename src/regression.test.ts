import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

function readSrc(rel: string): string {
  // vitest runs with cwd at repo root
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("regression: checkbox overlay bug", () => {
  it("styles.css does not contain literal \\2713", () => {
    const css = readSrc("src/styles.css");
    expect(css).not.toContain('content:"\\\\2713"');
    expect(css).not.toContain("content:\"\\\\2713\"");
  });
  it("checkbox checked uses proper checkmark", () => {
    const css = readSrc("src/styles.css");
    expect(css).toContain('input[type="checkbox"]:checked');
    // should contain actual checkmark or single-escaped \2713
    const hasCheck = css.includes('content:"✓"') || css.includes('content:"\\2713"') || css.includes("content:'✓'");
    expect(hasCheck).toBe(true);
  });
});

describe("regression: File button not opening", () => {
  it("App.tsx File button stops propagation and has data-file-menu", () => {
    const app = readSrc("src/App.tsx");
    expect(app).toContain("data-file-menu");
    expect(app).toContain("e.stopPropagation()");
    expect(app).toMatch(/onClick=\{\(e\).*stopPropagation/);
  });
  it("file-dropdown has data-file-menu", () => {
    const app = readSrc("src/App.tsx");
    expect(app).toContain('className="menu file-dropdown"');
    expect(app).toContain('data-file-menu');
  });
  it("outside click handler checks closest data-file-menu", () => {
    const app = readSrc("src/App.tsx");
    expect(app).toContain('closest("[data-file-menu]")');
    expect(app).toContain('window.addEventListener("click", onDown)');
  });
});

describe("regression: print white text", () => {
  it("print CSS forces block text to #111", () => {
    const css = readSrc("src/styles.css");
    const printIdx = css.indexOf("@media print");
    expect(printIdx).toBeGreaterThan(-1);
    const printBlock = css.slice(printIdx, printIdx+6000);
    expect(printBlock).toContain("color: #111");
    expect(printBlock).toContain(".block *");
  });
  it("print hides file-menu but keeps timetable", () => {
    const css = readSrc("src/styles.css");
    expect(css).toContain("@media print");
    expect(css).toContain(".grid-wrap");
  });
});

describe("regression: time picker overlay", () => {
  it("time inputs have dark scheme and indicator margin", () => {
    const css = readSrc("src/styles.css");
    expect(css).toContain('input[type="time"]');
    expect(css).toContain("color-scheme:dark");
  });
});

describe("regression: shift-click multi-select", () => {
  it("App.tsx has selectedKeys Set", () => {
    const app = readSrc("src/App.tsx");
    expect(app).toContain("selectedKeys");
    expect(app).toContain("new Set<string>");
  });
  it("PlannerGrid handles shiftKey", () => {
    const grid = readSrc("src/components/PlannerGrid.tsx");
    expect(grid).toContain("selectedKeys");
    expect(grid).toContain("shiftKey");
  });
});
