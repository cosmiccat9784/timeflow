import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

/**
 * The macOS DMG must contain a signed (ad-hoc) universal .app bundle.
 * Without a signature Gatekeeper reports "Time Flow is damaged and can't be
 * opened" for any downloaded copy, so these assertions protect the fix.
 */
describe("macOS packaging — notarisation-free but not damaged", () => {
  const conf = () => JSON.parse(read("src-tauri/tauri.conf.json"));
  const workflow = () => read(".github/workflows/build.yml");

  it("enables ad-hoc code signing in the Tauri config", () => {
    const mac = conf().bundle.macOS;
    expect(mac).toBeDefined();
    expect(mac.signingIdentity).toBe("-");
  });

  it("disables hardened runtime for the ad-hoc identity", () => {
    // Hardened runtime without a Developer ID is not useful and can make the
    // ad-hoc signed bundle fail to launch.
    expect(conf().bundle.macOS.hardenedRuntime).toBe(false);
  });

  it("keeps a minimum macOS version", () => {
    expect(conf().bundle.macOS.minimumSystemVersion).toMatch(/^\d+\.\d+/);
  });

  it("builds a universal binary so Intel and Apple Silicon both run", () => {
    const y = workflow();
    expect(y).toContain("universal-apple-darwin");
    expect(y).toContain("aarch64-apple-darwin");
    expect(y).toContain("x86_64-apple-darwin");
  });

  it("re-signs the app bundle after building (ad-hoc path only)", () => {
    const y = workflow();
    expect(y).toContain("codesign --force --deep --sign -");
    expect(y).toContain("codesign --verify --deep --strict");
    expect(y).toContain("if: runner.os == 'macOS' && env.APPLE_CERTIFICATE == ''");
  });

  it("supports a Developer ID certificate when secrets are configured", () => {
    const y = workflow();
    expect(y).toContain("APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}");
    expect(y).toContain("APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}");
    expect(y).toContain("security import");
    expect(y).toContain("spctl --assess");
    expect(y).toContain("stapler validate");
  });

  it("does not re-sign with ad-hoc when a Developer ID is present", () => {
    const y = workflow();
    const guard = y.indexOf("if: runner.os == 'macOS' && env.APPLE_CERTIFICATE == ''");
    const adHoc = y.indexOf("codesign --force --deep --sign -");
    expect(guard).toBeGreaterThan(-1);
    expect(adHoc).toBeGreaterThan(guard);
  });

  it("rebuilds the DMG from the signed bundle", () => {
    const y = workflow();
    expect(y).toContain("hdiutil create");
    expect(y).toContain("hdiutil verify");
  });

  it("verifies the app inside the mounted DMG", () => {
    const y = workflow();
    expect(y).toContain("hdiutil attach");
    expect(y).toContain("hdiutil detach");
    const attach = y.indexOf("hdiutil attach");
    const verify = y.indexOf('codesign --verify --deep --strict "$MOUNT/Time Flow.app"');
    expect(verify).toBeGreaterThan(attach);
  });

  it("uploads the bundle directory that the universal build actually writes to", () => {
    const y = workflow();
    expect(y).toContain("bundle_dir: src-tauri/target/universal-apple-darwin/release/bundle");
    expect(y).toContain("path: ${{ matrix.bundle_dir }}/");
  });

  it("the DMG target still ships as an artifact named for the platform", () => {
    const y = workflow();
    expect(y).toMatch(/name: timeflow-\$\{\{ runner\.os \}\}-\$\{\{ matrix\.artifact \}\}/);
    expect(y).toContain("artifact: dmg");
  });
});

describe("README tells macOS users how to open an unsigned build", () => {
  it("documents the Gatekeeper override", () => {
    const readme = read("README.md");
    expect(readme.toLowerCase()).toContain("macos");
    expect(readme.toLowerCase()).toMatch(/unidentified developer|open anyway|xattr/);
  });
});
