# Theme backgrounds

Drop image files here (`.jpg`, `.png`, `.webp`, `.svg`) and reference them by
filename from `../themes.json`:

```json
"background": { "mode": "image", "image": "my-background.jpg", "dim": 55 }
```

- Paths are relative to this folder.
- Landscape images work best (1600×900 or larger).
- `dim` is 0–100: how much dark veil sits over the image. Raise it if text is
  hard to read.
- Nothing is uploaded anywhere; these ship inside the app.

The two `*.svg` files here are ready-made gradients you can copy or replace.
