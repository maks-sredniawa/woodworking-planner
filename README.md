# Woodworking planner

Tool. A web app to plan a woodworking project and see it as a 3D render, all worked out on your own computer, before you cut the first board.

In development: the first version works locally, in the Workbench layout (direction A in `design/DESIGN.md`).

## What it's for

For anyone building furniture or other projects from boards and sheet goods: lay the parts out in 3D, catch mistakes such as boards that overlap, and get the cut list before buying wood or cutting anything. Nothing leaves your computer: no account and no server.

## First version

- A project is a name and a list of parts. Every part is a rectangular board: length, width and thickness in millimetres, the position of its left, bottom, back corner, how it lies (six orientations), and its wood.
- Add, duplicate, delete and edit boards. Clicking a board in the 3D view picks it in the list and the other way round.
- Move a board by dragging it in the 3D view once it is picked. Floor or Height in the toolbar picks whether it slides along the floor or goes up and down; holding Shift switches mid-drag and letting go switches back, so one drag can slide, lift and slide again. With Snap on (remembered per browser) it sits flush against other boards or on a 10 mm grid; holding Alt does the opposite, also mid-drag. Arrow keys nudge it 10 mm, Shift+arrow 1 mm, Alt+↑/↓ back and forth. A whole drag is one undo step.
- Lock a board in place (edit panel or its row in the list): a locked board can't be dragged, nudged, rotated, resized or deleted, and a drag that starts on it turns the view instead. Its name and wood can still change, the lock is saved with the project, and a copy of it starts unlocked.
- Turn, Tip and Roll rotate the picked board 90° around its centre (keys R, T, L), and a board on the floor stays on it. The Lies list still sets any of the six ways directly.
- The 3D view redraws only when something changes, so an idle page leaves the GPU alone.
- Potato (top bar, remembered per browser) draws faster on slow computers: 1× pixels, no shadows, flat colours without grain and simpler lighting. Boards keep their wood colour, which costs nothing. On a software renderer at 2× pixel density, turning the view went from 18–29 to 60 frames a second.
- Debug (top bar) shows the graphics card in use, frames per second, GPU time per frame where the browser allows measuring it, and the app's CPU time. A web page cannot read the whole computer's GPU or CPU load, so these are the app's own share.
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
- Hosting: a page on maksforge.com, installable for offline use.

## Contributing

Woodworking planner is source-available, not open source: read it, verify it, file issues. Pull requests are not accepted — see [LICENSE](LICENSE).
