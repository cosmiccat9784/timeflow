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
