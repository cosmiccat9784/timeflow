// Native file dialogs + storage with browser fallbacks (§23.5).
// Inside packaged Tauri builds the native dialogs are used; in a plain
// browser (dev/preview) we fall back to <input type=file> and downloads.

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface PickedFile {
  name: string;
  data: Uint8Array;
}

function browserPick(accept: string): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) {
        resolve(null);
        return;
      }
      f.arrayBuffer().then(
        (buf) => resolve({ name: f.name, data: new Uint8Array(buf) }),
        () => resolve(null),
      );
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function pickFile(
  extensions: string[],
  label: string,
): Promise<PickedFile | null> {
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({
        multiple: false,
        filters: [{ name: label, extensions }],
      });
      if (typeof path !== "string" || !path) return null;
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const data = await readFile(path);
      const name = path.split(/[\\/]/).pop() ?? "file";
      return { name, data };
    } catch {
      // fall through to browser picker
    }
  }
  return browserPick(extensions.map((e) => `.${e}`).join(","));
}

export async function saveFile(
  suggestedName: string,
  data: Uint8Array,
  mime: string,
): Promise<{ ok: boolean; error?: string }> {
  if (isTauri()) {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({ defaultPath: suggestedName });
      if (!path) return { ok: true }; // user cancelled — not an error
      const { writeFile } = await import("@tauri-apps/plugin-fs");
      await writeFile(path, data);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "TimeFlow could not write the file." };
    }
  }
  try {
    const blob = new Blob([data.buffer as ArrayBuffer], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "TimeFlow could not write the file." };
  }
}

export function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
