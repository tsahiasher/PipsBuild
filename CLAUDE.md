# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pips Build: a browser-only React + TypeScript + Vite app that reconstructs a Pips-style domino puzzle from a screenshot and lets the user play it. Hard constraints: no backend, no remote OCR/AI, no uploads, and no NYT branding or assets (styling is original). The `game*.jpg` files in the root are the reference screenshots and the vision regression fixtures: phone captures plus desktop captures (`game5` = `game4`'s puzzle, `game8` = `game7`'s) at different scales and aspect ratios.

## Commands

- `npm run dev`: dev server. `npm run build`: typecheck (`tsc --noEmit`) plus static build to `dist/` (relative `base`, works from any static host).
- `npm test`: all Vitest suites. `npm run test:engine` / `npm run test:vision` run one side.
- Single test: `npx vitest run tests/engine/game.test.ts -t "repair mode"`.
- Stop the dev server before running the tests. With `npm run dev` running, every test file has failed to load ("no tests"); the cause hasn't been pinned down.
- `npm run analyze [game1 game4 ...]`: prints each sample's reconstruction as ASCII (grid, regions, badges, dominoes, confidence). Use it when touching `src/vision`. `BROWSER=1` analyses the Chrome-decoded pixels instead; `SKIP=1` skips glyph classification and shows glyph counts.
- `npm run train:glyphs`: regenerates `src/vision/glyphTemplates.ts` from the screenshots plus `tests/vision/groundTruth.ts` (Node decode, Chrome decode, and ×0.6/×0.45 downscales). It prints badges whose glyph count is wrong and a leave-one-puzzle-out accuracy check. Rerun it after any change to glyph extraction or features, and before running the vision tests.

## Architecture

Three layers. Game rules never live in React components.

- `src/engine/` is pure game logic with no DOM.
  - `types.ts`: `Puzzle` (sparse `cells` keyed `"row,col"`, `regions`, `dominoes` with unique ids so duplicate values stay distinct pieces). A `Placement` is `{cellA, cellB}`, where value `a` sits on `cellA`. Placements are stored as cell ids, never pixels.
  - `placement.ts`: `canPlaceDomino` / `placeDomino` / `removeDomino` / `rotatePlacement` / `getBoardValues`. `rotatePlacement(p, pivot)` turns clockwise around a fixed pivot cell (default: the top/left cell); the UI keeps the pivot fixed for a whole selection, so four taps circle back to the start. `Rotation` 0–3 = A left / top / right / bottom.
  - `constraints.ts`: `evaluateRegion` → `{complete, valid, impossible}` for sum / lt / gt / eq / neq. All condition logic lives here.
  - `game.ts`: `gameReducer(puzzle, state, action)`. Owns the timer (`elapsedMs` + `startedAt`; actions carry `now`), `validationMode` (`normal` → `repair` the first time the board is full but wrong; repair survives removals and is cleared only by reset), solve detection (stops the timer, freezes the board), and `visibleErrors()`, which drives the red dots.
  - `puzzleFile.ts`: the JSON save/import format (`pips-build-puzzle` v1; legacy `pip-studio-puzzle` still imports) with validation.
  - `puzzle.ts`: consistency checks (cells === 2 × dominoes, odd board pieces), `normalizePuzzle` (assigns a content-hash `id`; games are keyed by it), `badgeCell` (the region's lowest-then-rightmost cell. The badge sits on that cell's bottom-right corner, both in screenshots, where recognition relies on it, and in the app, which draws it above the translucent dominoes), `parseConstraint`.
- `src/vision/` is screenshot → `Puzzle`. It's pure TS over `{width, height, data}`, so the same code runs in a Web Worker (`worker.ts`, driven by `client.ts`) and in Node tests (`scripts/load.ts` decodes JPEGs with `jpeg-js`). It doesn't use OpenCV or Tesseract. Pipeline in `recognize.ts`:
  1. Dominoes: dark-outline rings of one common size; pips are counted as dark blobs per half.
  2. Board: mid-tone components containing the beige frame color.
  3. Pitch: tray domino width ÷ 1.45 as the prior; each board piece measures `n·pitch + 2·0.053·pitch`. Candidates are scored by board-dimension residuals and by whether the cell count equals 2 × dominoes.
  4. Cells: center-box coverage.
  5. Regions: adjacent cells are unioned when the seam between them matches both cells' colors (threshold 0.53; same-region seams score ≥ 0.7, boundaries ≤ 0.35). Unconstrained cells are detected by closeness to the neutral/frame color.
  6. Badges: strong-color mask → fill holes → morphological open (removes dashed borders) → components. Each badge maps to the region via `badgeCell`.
  7. Glyphs: the badge crop is resampled to a fixed scale (`GLYPH_REF_PITCH`) using bilinear interpolation of a whiteness score `L − 2·C`. It's then thresholded adaptively per badge (between the badge color and the brightest text), restricted to the badge's own filled shape and its central zone (the badge notch holds pastel pockets), and split into characters. Fragments are re-merged and touching characters split. Glyphs are classified against `glyphTemplates.ts` (vocabulary `0–9 < > = ≠`).

  Board connectivity counts badge and dash pixels as board. Otherwise a cell boxed in by borders and badges on every side can be cut off from its piece; this happened with Chrome's decode of `game6`.

  All thresholds are relative to the pitch. Never hard-code pixel coordinates.
- `src/ui/` is React. `Board.tsx` renders any puzzle as SVG (100 units per cell; region outlines via `boardGeometry.ts` loop tracing plus inset). `PlayScreen.tsx` handles interaction: Pointer Events with capture on the stable root element (not native DnD), snap preview via `computePreview`, tap-to-rotate in the tray, select-then-tap rotation on the board with a 2 s auto-deselect (an illegal tentative rotation reverts; legal rotations commit immediately), and keyboard control. `EditorScreen.tsx` is both the verify screen and the manual builder, including the screenshot overlay comparison, which uses `recognition.geometry` (`originX/originY/pitch` in image px).
- `src/App.tsx` + `src/state/storage.ts`: screen routing and localStorage persistence. Games are kept per puzzle id. On load, running timers are frozen at `savedAt` (closed-browser time isn't counted), and a saved `play` screen reopens on Home with "Resume puzzle".

## Tests

- `tests/engine/*` cover the rules, the reducer and pip patterns.
- `tests/vision/recognize.test.ts` asserts that every reference screenshot reconstructs exactly to `tests/vision/groundTruth.ts`, both as decoded by jpeg-js and as decoded by Chrome. The pixels differ slightly, so both must pass.
- `tests/vision/numbers.test.ts` repaints real badges with every value 0–24 and all operators, using real glyph pixels, and reads them at phone and desktop scale.
- `tests/vision/solvable.test.ts` runs a backtracking solver (`tests/helpers/solver.ts`) to prove each recognized puzzle has a solution.

To add a screenshot fixture:
1. Add its truth entry to `groundTruth.ts`.
2. Regenerate its Chrome-decoded PNG in `tests/vision/browser-decoded/`. This is a lossless dump of `loadImageFile()`'s ImageData, taken in Chrome from the running dev server.
3. Run `npm run train:glyphs`, then `npm test`.
