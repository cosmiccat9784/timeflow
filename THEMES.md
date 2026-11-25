# Making your own theme

Themes are plain JSON. No code, no rebuild needed for imported themes.

Two places themes can live:

| Where | Who can edit it | Persisted |
|---|---|---|
| `public/themes/themes.json` | you, before building | ships inside the app |
| Themes → **Import theme file…** | anyone, while running | saved with your data + backups |
| Themes → **Save current as theme…** | anyone | saved with your data + backups |

## Quick start

1. Open **Themes** in the sidebar.
2. Click **Download template** — you get `my-theme.json`.
3. Edit it (any text editor).
4. Click **Import theme file…** and pick it. It appears in the grid immediately.

## File format

```json
{
  "version": 1,
  "backgroundsPath": "backgrounds",
  "themes": [
    {
      "id": "my-theme",
      "name": "My Theme",
      "base": "dark",
      "accent": "#7C5CFF",
      "highlight": "#22D3EE",
      "colours": {
        "main": "#050505",
        "sidebar": "#181818",
        "panel": "#202020",
        "elevated": "#292929",
        "border": "#303030",
        "gridLine": "#1E1E1E",
        "text": "#F2F2F2",
        "textSecondary": "#B0B0B0",
        "textMuted": "#858585"
      },
      "fonts": {
        "sans": "\"Inter\", system-ui, sans-serif",
        "heading": "\"Inter\", system-ui, sans-serif",
        "size": 14
      },
      "background": {
        "mode": "image",
        "image": "my-background.jpg",
        "dim": 55
      }
    }
  ]
}
```

A bare array (`[ { …theme… } ]`) is also accepted.

## Fields

### Required

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique. Letters, numbers, `-`, `_`. Used in saved settings. |
| `name` | string | Shown on the theme card. |
| `base` | `"dark"` \| `"light"` | Starting palette and the window chrome (`data-theme`). |
| `accent` | `#RRGGBB` | Buttons, active menu items, toggles, focus rings. |

### Optional

| Field | Type | Default | Notes |
|---|---|---|---|
| `highlight` | `#RRGGBB` | same as `accent` | Selection outline and the “today” ring. |
| `colours` | object | base palette | Any subset of the keys below; omitted keys inherit from `base`. |
| `fonts.sans` | CSS font stack | Inter fallback stack | Body text. |
| `fonts.heading` | CSS font stack | same as `sans` | Headings and the toolbar title. |
| `fonts.size` | number | `14` | Clamped to 13–18 px. |
| `background.mode` | `"none"` \| `"solid"` \| `"image"` | `"none"` | `none` keeps the theme's own surfaces. |
| `background.colour` | `#RRGGBB` | — | Required for `solid`; also the base behind an image. |
| `background.image` | string | — | Filename inside `backgrounds/`, or a `data:` URL. |
| `background.dim` | number 0–100 | `45` | Dark veil over the image. Raise it if text is hard to read. |
| `builtin` | boolean | `false` | Marks shipped presets; imported themes ignore it. |

### Palette keys

`main` (page), `sidebar`, `panel` (cards and toolbar), `elevated` (menus and
modals), `border`, `gridLine`, `text`, `textSecondary`, `textMuted`.

Only 6-digit hex is accepted. Anything else is rejected with a message naming
the field, so a typo can never half-apply a theme.

## Background images

Put files in `public/themes/backgrounds/` and reference them by filename:

```json
"background": { "mode": "image", "image": "my-background.jpg", "dim": 60 }
```

- Landscape works best (1600×900 or larger).
- `.jpg`, `.png`, `.webp` and `.svg` are fine.
- Two ready-made gradients ship there (`aurora.svg`, `sunset.svg`).
- Imported themes can also embed an image as a `data:` URL, but a filename is
  much smaller.
- You can also pick a wallpaper from **Themes → Background → Image**, which
  downscales it to ≤1920 px and stores it locally (never uploaded).

## How overrides work

The Customise section applies **on top of** the selected theme:

- **Inherit** clears an override so the theme's own value applies again.
- Switching presets keeps your overrides.
- **Save current as theme…** bakes the current overrides into a new theme.
- Overrides are stored per-user, so your presets stay untouched.

## What is themed

Everything that reads CSS custom properties: window chrome, sidebar, toolbar,
day headers, grid lines, cards, menus, modals, dropdowns, checkboxes, toasts,
selection outlines, the “now” line and the today ring. Print output is always
plain white paper, whatever the theme.

## Tips

- Start from `base: "dark"` and change only `accent` + `background` — that is
  usually enough.
- For a light theme use `base: "light"`; text colours then default to dark ink.
- Contrast on the accent is computed automatically (black or white ink), so
  bright accents like `#A3E635` stay readable.
- Keep `dim` at 40–65 for photos; below 30 body text can become hard to read.
