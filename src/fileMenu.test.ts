// @ts-nocheck
import { describe, expect, it, vi } from "vitest";

// Test the File menu outside-click logic in isolation
function createMockElement(closestReturn: any) {
  return { closest: vi.fn(() => closestReturn) } as any;
}

describe("File button - outside click handler", () => {
  it("does not close when clicking inside data-file-menu", () => {
    let closed=false;
    const onDown=(e:any)=>{
      const target=e.target as HTMLElement;
      if(target.closest("[data-file-menu]")) return;
      closed=true;
    };
    const inside=createMockElement({});
    onDown({target: inside});
    expect(closed).toBe(false);
    expect(inside.closest).toHaveBeenCalledWith("[data-file-menu]");
  });
  it("closes when clicking outside", () => {
    let closed=false;
    const onDown=(e:any)=>{
      const target=e.target as HTMLElement;
      if(target.closest("[data-file-menu]")) return;
      closed=true;
    };
    const outside=createMockElement(null);
    onDown({target: outside});
    expect(closed).toBe(true);
  });
  it("File button toggles without stopPropagation", async () => {
    const fs=await import("fs");
    const path=await import("path");
    const app=fs.readFileSync(path.join(process.cwd(), "src/App.tsx"), "utf8");
    // Should have mousedown handler, not rely on stopPropagation
    expect(app).toContain('window.addEventListener("mousedown"');
    expect(app).toContain('closest("[data-file-menu]")');
    // Button should NOT have stopPropagation (we removed it)
    expect(app).not.toContain("e.stopPropagation()");
    expect(app).toContain('onClick={() => setFileMenuOpen');
  });
});

describe("File button - regression", () => {
  it("dropdown and button share data-file-menu", async () => {
    const fs=await import("fs");
    const path=await import("path");
    const app=fs.readFileSync(path.join(process.cwd(), "src/App.tsx"), "utf8");
    // Both should have data-file-menu
    const fileMenuCount=(app.match(/data-file-menu/g)||[]).length;
    expect(fileMenuCount).toBeGreaterThanOrEqual(2);
  });
});

describe("File dropdown positioning - must be visible", () => {
  it(".menu.file-dropdown overrides fixed with absolute", async () => {
    const fs=await import("fs");
    const path=await import("path");
    const css=fs.readFileSync(path.join(process.cwd(), "src/styles.css"), "utf8");
    expect(css).toContain(".menu.file-dropdown");
    expect(css).toContain("position: absolute");
  });
});

describe("Version consistency", () => {
  it("package, tauri and store versions match", async () => {
    const fs=await import("fs");
    const path=await import("path");
    const pkg=JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    const tauri=JSON.parse(fs.readFileSync(path.join(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"));
    const store=fs.readFileSync(path.join(process.cwd(), "src/store.ts"), "utf8");
    expect(tauri.version).toBe(pkg.version);
    expect(store).toContain('APP_VERSION = "' + pkg.version + '"');
    expect(store).not.toContain("export const undefined");
  });
});
