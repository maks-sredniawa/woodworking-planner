# Woodworking planner

Tool. A web app to plan a woodworking project and see it as a 3D render, all worked out on your own computer, before you cut the first board.

In development: the first version works locally, in the Workbench layout (direction A in `design/DESIGN.md`).

## What it's for

For anyone building furniture or other projects from boards and sheet goods: lay the parts out in 3D, catch mistakes such as boards that overlap, and get the cut list before buying wood or cutting anything. Nothing leaves your computer: no account and no server.

## First version

- A project is a name and a list of parts. Every part is a rectangular board: length, width and thickness in millimetres, the position of its left, bottom, back corner, how it lies (six orientations), and its wood.
- Add, duplicate, delete and edit boards. Clicking a board in the 3D view picks it in the list and the other way round.
- 3D view with wood colours and grain along the length, shadows, a 100 mm floor grid, orbit, zoom and pan, Iso, Front, Side and Top cameras, and Fit.
- Workbench layout: parts on the left, the 3D view with the cut list under it in the middle, the selected board on the right. On a phone the 3D view stays on top with Parts, Edit and Cut list tabs below.
- Boards that overlap are flagged in the list.
- Cut list: identical boards of the same wood are grouped; totals give board count, volume, face area and approximate weight, plus the overall size.
- Undo and redo (Ctrl+Z, Ctrl+Shift+Z). Rapid typing in one field counts as one step.
- Autosaves in the browser. Save and open a project as a `.woodplan.json` file.
- Opens with an example bookshelf; New starts an empty project and Example brings the bookshelf back.

## Run it

```bash
npm start
```

Then open http://127.0.0.1:8777/. There is no build step; three.js is vendored in `vendor/three/` (0.180.0, MIT), so it runs offline.

## Tests

```bash
npm test
```

```bash
uv run --with playwright python tests/browser/ui_test.py
```

## Open questions

- Units: millimetres only, or inches and fractions as well?
- Joinery: should parts know about joints (dados, tenons, dowels) so lengths and the cut list account for them?
- Sheet goods: a cutting plan that nests parts onto standard boards or plywood sheets, with saw kerf?
- Shapes beyond rectangular boards (rounds, angled cuts)?
- Moving boards by dragging in 3D, and snapping to other boards.
- Hosting: a page on maksforge.com, installable for offline use.

## Contributing

Woodworking planner is source-available, not open source: read it, verify it, file issues. Pull requests are not accepted — see [LICENSE](LICENSE).
