## Overview

The interface is branded around the blue mark in `frontend/public/logo.png`, but the product should not read as an all-blue UI. WSIRI Blue is the brand and action color; the main workspace is a clean white operational surface with quiet neutral dividers and only a light blue hint where hierarchy needs it. The product should feel like a precise documentation and operations workspace: calm, technical, readable, and clearly owned by the WSIRI brand without becoming visually heavy.

The light theme atmosphere is a **white-first canvas** (`{colors.canvas}` - #ffffff) with a very pale blue page wash available only for large background zones (`{colors.canvas-tint}` - #f7f9fe). Primary actions, focus states, active navigation, links, and brand highlights use **WSIRI Blue** (`{colors.primary}` - #164199), sampled from the logo. The system uses dark ink text, neutral slate secondary text, and layered color blocks so dense chat, settings, and management screens remain easy to scan without relying on visible outlines.

The dark theme follows the earlier black product direction from git history instead of turning into a blue night mode. Dark screens use warm-black surfaces (`{colors.surface-dark}` - #181715) with charcoal elevated layers and blue reserved for actions, links, focus, and selected states.

The surface model has four layers:

1. **Canvas** (`{colors.canvas}`) - primary page floor and full-screen app background
2. **Panel** (`{colors.surface-panel}`) - primary cards, dialogs, forms, and chat input areas
3. **Tinted Surface** (`{colors.surface-soft}`) - sidebars, segmented controls, secondary panels, inputs, and empty states
4. **Black Product Surface** (`{colors.surface-dark}`) - dark mode canvas, console previews, code blocks, footer-like product chrome, and high-contrast overlays

**Key Characteristics:**
- Logo-derived WSIRI Blue (`{colors.primary}` - #164199) anchors every important action and active state.
- White canvas (`{colors.canvas}` - #ffffff) keeps the workspace crisp, with `{colors.canvas-tint}` used only when the page needs a gentle blue cast.
- White panels (`{colors.surface-panel}` - #ffffff) carry form, chat, card, and dialog content.
- Neutral and lightly tinted support surfaces (`{colors.surface-soft}` - #f5f7fb, `{colors.surface-raised}` - #eef2f7) act as color blocks for controls, grouped rows, and secondary panels without making the whole interface blue.
- Black product surfaces (`{colors.surface-dark}` - #181715) are reserved for dark mode, console/code/product preview moments, and high-contrast chrome.
- Amber and cyan are secondary accents only, used for status dots, warning badges, metadata chips, and small chart-like details.
- Border radius stays practical: 8px for controls, 12px for panels, 16px for large auth/dialog surfaces.

## Colors

### Brand & Accent

- **WSIRI Blue / Primary** (`{colors.primary}` - #164199): The logo blue. Used for primary buttons, active nav, links, focus rings, selected states, and key icon accents.
- **Primary Hover** (`{colors.primary-hover}` - #10357f): Darker blue for hover/press states.
- **Primary Soft** (`{colors.primary-soft}` - #eaf1ff): Low-emphasis blue fill for selected rows, subtle callouts, and active backgrounds. Use in small areas only.
- **Primary Mist** (`{colors.primary-mist}` - #f5f8ff): Very light blue wash for rare, large quiet surfaces. Prefer white when in doubt.
- **Accent Cyan** (`{colors.accent-cyan}` - #18a8b8): Used sparingly for connection/streaming/online indicators and secondary console dots.
- **Accent Amber** (`{colors.accent-amber}` - #d99a24): Used for warning-adjacent metadata, knowledge/tool badges, and small attention markers.

### Surface

- **Canvas** (`{colors.canvas}` - #ffffff): Default app floor.
- **Canvas Tint** (`{colors.canvas-tint}` - #f7f9fe): Optional page wash for login, empty states, and full-screen backgrounds that need softness.
- **Surface Panel** (`{colors.surface-panel}` - #ffffff): Cards, dialogs, forms, chat input, dropdowns.
- **Surface Soft** (`{colors.surface-soft}` - #f5f7fb): Sidebar floor, segmented controls, soft bands.
- **Surface Raised** (`{colors.surface-raised}` - #eef2f7): Slightly stronger neutral block fill for nested surfaces, compact controls, selected rows, and toolbar clusters.
- **Surface Dark** (`{colors.surface-dark}` - #181715): Dark mode canvas, console previews, dark code windows, high-contrast chrome.
- **Surface Dark Elevated** (`{colors.surface-dark-elevated}` - #252320): Cards and rows inside dark product surfaces.
- **Surface Dark Soft** (`{colors.surface-dark-soft}` - #1f1e1b): Inner code/terminal blocks.
- **Divider** (`{colors.divider}` - #e8edf5): Rare separators between major layout regions only. Do not use as a component border.
- **Focus Halo** (`{colors.focus-halo}` - rgba(22, 65, 153, 0.16)): Accessible focus state around controls.

### Text

- **Ink** (`{colors.ink}` - #111827): Headlines and primary UI text.
- **Body Strong** (`{colors.body-strong}` - #243244): Emphasized paragraphs and important row text.
- **Body** (`{colors.body}` - #334155): Default running text.
- **Muted** (`{colors.muted}` - #64748b): Secondary labels, hints, timestamps, metadata.
- **Muted Soft** (`{colors.muted-soft}` - #94a3b8): Captions and disabled-adjacent text.
- **On Primary** (`{colors.on-primary}` - #ffffff): Text/icons on primary blue.
- **On Dark** (`{colors.on-dark}` - #faf9f5): Main text on black product surfaces.
- **On Dark Soft** (`{colors.on-dark-soft}` - #a09d96): Secondary text on black product surfaces.

### Semantic

- **Success** (`{colors.success}` - #1f9d63): Connected, available, complete.
- **Warning** (`{colors.warning}` - #d99a24): Needs attention, partial state.
- **Error** (`{colors.error}` - #c2413d): Validation and destructive state.

## Typography

The product uses a practical sans-first stack for dense application screens. Display headings may use the existing display font, but they should stay restrained and readable, especially in dashboards and settings.

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---:|---:|---:|---:|---|
| `{typography.display-lg}` | 48px | 500 | 1.05 | 0 | Auth/login hero headline |
| `{typography.display-md}` | 36px | 500 | 1.12 | 0 | Major empty states and page titles |
| `{typography.title-lg}` | 22px | 600 | 1.3 | 0 | Dialog and panel titles |
| `{typography.title-md}` | 18px | 600 | 1.35 | 0 | Card titles, section headers |
| `{typography.title-sm}` | 16px | 600 | 1.4 | 0 | List item titles |
| `{typography.body-md}` | 16px | 400 | 1.55 | 0 | Default content |
| `{typography.body-sm}` | 14px | 400 | 1.5 | 0 | UI copy, secondary rows |
| `{typography.caption}` | 12px | 500 | 1.4 | 0 | Badges, metadata, table labels |
| `{typography.code}` | 13px | 400 | 1.65 | 0 | Code, terminal, traces |

Display text must not use negative tracking. This is an operational UI, not an editorial landing page; compact panels need stable, legible text.

## Layout

- **Base unit:** 4px.
- **Spacing tokens:** `{spacing.xxs}` 4px, `{spacing.xs}` 8px, `{spacing.sm}` 12px, `{spacing.md}` 16px, `{spacing.lg}` 24px, `{spacing.xl}` 32px, `{spacing.xxl}` 48px.
- **App shell:** Fixed-height viewport with sidebar, header, and a flexible content pane.
- **Panels:** Use 16-24px padding for dense tools, 24-32px for auth/dialog surfaces.
- **Data views:** Favor predictable rows, filled tabs, and toolbar blocks over decorative cards or outlined boxes.
- **Login/auth:** Brand mark appears in the first viewport and uses the primary blue as the main visual signal.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| Flat | No shadow | App shell, sidebars, large content floors |
| Color block | Light neutral or primary-tinted fill, no border | Inputs, rows, buttons, tabs, toolbars |
| Soft panel | White or lightly tinted fill with subtle shadow or adjacent contrast | Cards, auth panel, settings panels |
| Dark product | Warm-black fill, internal charcoal rows | Dark mode, console previews, and code windows |
| Shadow | `0 8px 24px rgba(15, 23, 42, 0.10)` or lighter | Dialogs, popovers, floating controls |

Depth should come from surface contrast first. Use borders only as structural separators between major regions or table cells where fill alone cannot preserve scanability. Shadows are for floating UI only.

## Shapes

| Token | Value | Use |
|---|---:|---|
| `{rounded.xs}` | 4px | Tiny badges and inline code |
| `{rounded.sm}` | 6px | Dropdown items and compact controls |
| `{rounded.md}` | 8px | Buttons, inputs, tabs |
| `{rounded.lg}` | 12px | Cards and standard panels |
| `{rounded.xl}` | 16px | Auth panel, dialogs, larger previews |
| `{rounded.pill}` | 9999px | Pills, avatars, status dots |

## Components

### Buttons

- **Primary:** `{colors.primary}` background, `{colors.on-primary}` text, 8px radius, clear hover to `{colors.primary-hover}`.
- **Secondary:** `{colors.surface-soft}` fill, ink text, stronger neutral hover fill. Do not add a border.
- **Ghost/Icon:** Transparent by default, neutral hover block, primary text only when active.
- **Destructive:** Error color for text/fill, never reuse primary blue for destructive actions.

### Panels & Cards

- **App panels:** White or soft background, no border, 12px radius, subtle shadow only when the panel floats above the page.
- **Sidebar:** White or `{colors.surface-soft}` background with selected rows in `{colors.primary-soft}`. Avoid large saturated blue sidebar fields and outlined nav items.
- **Chat input:** Soft filled panel with blue focus ring. Avoid a visible border.
- **Console preview:** `{colors.surface-dark}` with `{colors.surface-dark-soft}` inner rows, blue/cyan/amber status dots.
- **Auth panel:** White panel on white or `{colors.canvas-tint}` canvas with primary-blue action buttons.

### Dark Mode

- Use `{colors.surface-dark}` as the app floor, not a navy replacement for every surface.
- Elevated dark panels use `{colors.surface-dark-elevated}` with `{colors.surface-dark-soft}` for nested rows, inputs, code, and terminal blocks.
- Text uses `{colors.on-dark}` and `{colors.on-dark-soft}`. Avoid blue-gray text on dark mode unless the element is an active or linked state.
- Primary actions, focus rings, selected navigation, and links still use WSIRI Blue. Keep inactive dark chrome black/charcoal.
- In dark mode, use charcoal fill changes instead of blue-gray outlines. Blue appears on focused or selected controls through halo/fill, not borders.

### Inputs & Forms

- Default inputs use `{colors.surface-soft}` or `{colors.surface-raised}` fill and `{colors.ink}` text with no border.
- Focus state uses a 3-4px `{colors.primary}` ring at 12-16% opacity plus a slightly brighter fill.
- Placeholder and helper text use `{colors.muted}`.
- Errors use `{colors.error}` text/icon and a very light red fill; avoid red borders unless the component cannot otherwise signal the state.

### Tags / Badges

- **Primary badge:** `{colors.primary-soft}` fill, `{colors.primary}` text.
- **Amber badge:** Amber at low opacity for tool/knowledge metadata.
- **Cyan badge:** Cyan at low opacity for streaming/connection metadata.
- **Neutral badge:** `{colors.surface-raised}` fill, `{colors.muted}` text.

## Do's and Don'ts

### Do

- Use `frontend/public/logo.png` as the color anchor; primary blue should match the mark.
- Keep app surfaces neutral and bright; use white first, then light neutral color blocks, then pale blue only for selected or branded states.
- Use blue for active state, focus state, and primary action consistently.
- Keep dark mode anchored in black/charcoal surfaces, matching the earlier dark design direction from git history.
- Use amber/cyan only as supporting status colors.
- Keep dashboard and chat layouts dense, aligned, and easy to scan.
- Prefer token classes (`bg-primary`, `bg-card`, `bg-muted`, `text-muted-foreground`, `ring-primary/15`) over hard-coded hex values.

### Don't

- Don't reintroduce the old cream/coral Anthropic palette.
- Don't make the UI a single blue wash; white surfaces, neutral color blocks, and slate text are required for hierarchy.
- Don't turn dark mode into deep navy. Use blue only for interaction states and brand moments on top of black/charcoal surfaces.
- Don't use decorative color blobs as the primary background treatment.
- Don't use negative letter spacing in compact UI.
- Don't use borders as the default way to draw buttons, inputs, cards, or list items. Use color-block fills, spacing, typography, and focus rings first.

## Implementation Notes

- CSS tokens live in `frontend/app/globals.css`.
- The Tailwind token classes map to CSS variables through `@theme inline`.
- Existing `--coral` aliases may remain only for backward compatibility; they should point to WSIRI Blue.
- When implementing light theme screens, prefer `{colors.canvas}` and `{colors.surface-panel}` before reaching for `{colors.canvas-tint}` or `{colors.primary-mist}`.
- When implementing dark theme screens, map the dark background tokens to the black family (`#181715`, `#252320`, `#1f1e1b`) rather than the previous deep-blue family.
