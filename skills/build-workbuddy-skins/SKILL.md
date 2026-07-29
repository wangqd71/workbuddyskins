---
name: build-workbuddy-skins
description: Build, adapt, debug, validate, and package non-invasive full-page skins for the Windows WorkBuddy desktop app. Use when Codex is asked to create or modify a WorkBuddy theme, support dark/light appearance, add page backgrounds or character elements, replace BuddyCats/robot artwork, build task-running or workspace-preparing animation, diagnose blurred text or overlapping controls, inspect WorkBuddy DOM through CDP, or prepare a shareable ZIP and usage documentation.
---

# Build WorkBuddy Skins

Create WorkBuddy skins as external localhost CDP injectors. Preserve the installed application, account data, conversations, and native controls.

## Start here

1. Read [references/workflow.md](references/workflow.md) before changing a skin project.
2. Read [references/selectors-and-troubleshooting.md](references/selectors-and-troubleshooting.md) when auditing DOM, fixing rendering defects, or adding animation.
3. Locate the existing project and inspect its scripts, assets, tests, documentation, current version, and dirty files before editing.
4. Prefer extending a working injector over rebuilding it.

## Required workflow

1. Establish a baseline.
   - Detect the WorkBuddy executable and version.
   - Discover the executable across running processes, saved state, App Paths, uninstall `DisplayIcon`, common directories, and Start Menu shortcuts; provide a manual `WorkBuddy.exe` picker when discovery fails.
   - Capture the requested page in both appearances when applicable.
   - Inspect real DOM and computed styles; do not guess hashed class names.
2. Keep the architecture non-invasive.
   - Bind CDP to `127.0.0.1` only.
   - Never modify `WorkBuddy.exe`, `resources/app.asar`, account data, or conversation storage.
   - Scope all styles below `html[data-workbuddy-skin="<id>"]`.
   - Preserve restore and verification actions.
3. Implement complete visual coverage.
   - Define shared color, surface, border, text, and asset variables.
   - Cover home, sidebar, chat, projects, experts/connectors, automation, settings, menus, dialogs, and waiting pages.
   - Provide explicit dark and light rules; verify contrast rather than relying on inversion filters.
4. Preserve behavior.
   - Hide or restyle decoration without removing functional buttons.
   - Keep hit targets accessible and outside character faces.
   - Do not introduce layout containing blocks on already-positioned slots without checking their rectangles.
5. Build animation deliberately.
   - Prefer a compact transparent animated WebP plus a static PNG fallback.
   - Use slow, simple motion for small UI mascots.
   - Lock every frame to a common silhouette center and bottom baseline.
   - Respect `prefers-reduced-motion` by switching to the static asset.
6. Verify before release.
   - Run syntax and project tests.
   - Confirm the injected CSS variable is non-empty and the image is visible.
   - Capture two time-separated screenshots for animated elements.
   - Check dark/light, reduced motion, narrow windows, text sharpness, and button overlap.
7. Package and hand off.
   - Increment the version, update usage and license notes, build a ZIP, compute SHA256, reapply persistently, and run final verification.

## Asset rules

- When a new or edited raster asset is required, invoke the available `imagegen` skill and follow its transparency workflow.
- Do not hotlink runtime character art. Store final assets locally and inject them from the package.
- Keep third-party research images out of the release unless their license permits redistribution.
- Keep an animated Data URI small enough for Chromium CSS parsing; target less than about 1.5 MiB before Base64 and verify the computed custom property length.

## Bundled scripts

- Use `scripts/audit-workbuddy.mjs` to snapshot, click, inspect computed styles, or capture screenshots through an existing WorkBuddy CDP port.
- Use `scripts/build-anchored-animation.py` to convert a transparent sprite sheet into a slow interpolated WebP whose center and baseline remain fixed.
- Install animation dependencies only in a project-local temporary directory when absent: `python -m pip install --target <tmp> pillow numpy opencv-python-headless`.
- Copy scripts into the target project only when the project needs to retain or customize them; otherwise run them from this skill directory.

## Completion standard

Do not claim completion from a static source preview alone. Require a passing injector verification, visible in-app result, successful release build, and a final ZIP hash.
