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
    expect(y).toContain("env.APPLE_SIGNING_IDENTITY == ''");
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
    const guard = y.indexOf("env.APPLE_SIGNING_IDENTITY == ''");
    const adHoc = y.indexOf("codesign --force --deep --sign -");
    expect(guard).toBeGreaterThan(-1);
    expect(adHoc).toBeGreaterThan(guard);
  });

  it("never exports APPLE_CERTIFICATE to the build step", () => {
    // An empty APPLE_CERTIFICATE in the job environment makes Tauri attempt to
    // import an empty PKCS#12 and fail the whole macOS build, so the secret is
    // only passed to the dedicated import step.
    const y = workflow();
    expect(y).not.toMatch(/\n {4}env:\r?\n {6}APPLE_CERTIFICATE:/);
    expect(y).toContain("APPLE_CERTIFICATE is deliberately");
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
    // Explicit mountpoint avoids fragile parsing of hdiutil output.
    expect(y).toContain('-mountpoint "$MNT"');
    const attach = y.indexOf("hdiutil attach");
    const verify = y.indexOf('codesign --verify --deep --strict --verbose=2 "$APP_IN_DMG"');
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

describe("Windows publisher identity", () => {
  const conf = () => JSON.parse(read("src-tauri/tauri.conf.json"));
  const workflow = () => read(".github/workflows/build.yml");

  it("declares the publisher shown in Apps & Features", () => {
    expect(conf().bundle.publisher).toBe("cosmiccat9784");
  });

  it("declares a homepage and copyright", () => {
    const b = conf().bundle;
    expect(b.homepage).toContain("github.com/cosmiccat9784/timeflow");
    expect(b.copyright).toContain("cosmiccat9784");
  });

  it("configures a timestamp server for Authenticode", () => {
    const w = conf().bundle.windows;
    expect(w.digestAlgorithm).toBe("sha256");
    expect(w.timestampUrl).toMatch(/^http/);
  });

  it("the workflow signs the installer when a certificate is supplied", () => {
    const y = workflow();
    expect(y).toContain("WINDOWS_CERTIFICATE: ${{ secrets.WINDOWS_CERTIFICATE }}");
    expect(y).toContain("signtool sign /fd SHA256");
    expect(y).toContain("signtool verify /pa");
  });

  it("the Windows signing step is skipped gracefully without a certificate", () => {
    // SmartScreen still shows "Unknown publisher" for unsigned builds; the
    // guard keeps CI green instead of failing on a missing pfx.
    const y = workflow();
    const step = y.slice(y.indexOf("name: Sign Windows installer"));
    expect(step).toContain("if (-not $env:WINDOWS_CERTIFICATE)");
    expect(step).toContain("exit 0");
    const guard = step.indexOf("if (-not $env:WINDOWS_CERTIFICATE)");
    const sign = step.indexOf("signtool sign /fd SHA256");
    expect(guard).toBeGreaterThan(-1);
    expect(sign).toBeGreaterThan(guard);
  });
});

describe("README tells macOS users how to open an unsigned build", () => {
  it("documents the Gatekeeper override", () => {
    const readme = read("README.md");
    expect(readme.toLowerCase()).toContain("macos");
    expect(readme.toLowerCase()).toMatch(/unidentified developer|open anyway|xattr/);
  });
});
