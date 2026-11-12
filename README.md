# Woodworking planner

Tool. A web app to plan a woodworking project and see it as a 3D render, all worked out on your own computer, before you cut the first board.

In development: the first version works locally, in the Workbench layout (direction A in `design/DESIGN.md`).

## What it's for

For anyone building furniture or other projects from boards and sheet goods: lay the parts out in 3D, catch mistakes such as boards that overlap, and get the cut list before buying wood or cutting anything. Nothing leaves your computer: no account and no server.

## First version

- A project is a name and a list of parts. Each part has a shape, its sizes in millimetres, the position of its left, bottom, back corner, which way it faces (one of the 24 ways a piece can point), and its wood.
- Five shapes: Board (length, width, thickness), Disc (diameter, thickness), Dowel (diameter, length), Arc (a ring segment: outer radius, band width, sweep in degrees, thickness) and Triangle (right-angled: length and width are the two legs, plus thickness). Switching shape keeps length, width and thickness, so switching back loses nothing.
- A board's corners can be square, rounded or cut: pick which of the four corners, then one radius, or for a cut how far it runs along the length and along the width. One treatment per board.
- Add, duplicate, delete and edit parts. Add board is one click; the ▾ beside it adds a disc, dowel, arc or triangle. A copy goes on the floor beside the original, past any part already there. Clicking a part in the 3D view picks it in the list and the other way round. The list shows each part's outline in its wood colour.
- Move a board by dragging it in the 3D view once it is picked. Floor or Height in the toolbar picks whether it slides along the floor or goes up and down; holding Shift switches mid-drag and letting go switches back, so one drag can slide, lift and slide again. With Snap on (remembered per browser) it sits flush against other boards or on a 10 mm grid; holding Alt does the opposite, also mid-drag. Arrow keys nudge it 10 mm, Shift+arrow 1 mm, Alt+↑/↓ back and forth. A whole drag is one undo step.
- Lock a board in place (edit panel or its row in the list): a locked board can't be dragged, nudged, rotated, resized or deleted, and a drag that starts on it turns the view instead. Its name and wood can still change, the lock is saved with the project, and a copy of it starts unlocked.
- Turn, Tip and Roll rotate the picked piece 90° (keys R, T, L), so a triangle, an arc or a board with some corners shaped can face any of the 24 ways. It turns about the middle of its footprint and keeps its underside where it was, so a piece on the floor or on another piece stays resting there, however often it is turned. Two turns about the same axis face it the other way; four bring it back. The Lies list sets the six main ways directly; any other way shows as the nearest of the six plus how it is turned (for example `Lying flat, length front–back, spun half a turn`).
- The 3D view redraws only when something changes, so an idle page leaves the GPU alone.
- Potato (top bar, remembered per browser) draws faster on slow computers: 1× pixels, no shadows, flat colours without grain and simpler lighting. Boards keep their wood colour, which costs nothing. On a software renderer at 2× pixel density, turning the view went from 18–29 to 60 frames a second.
- Debug (top bar) shows the graphics card in use, frames per second, GPU time per frame where the browser allows measuring it, and the app's CPU time. A web page cannot read the whole computer's GPU or CPU load, so these are the app's own share.
- 3D view with wood colours and grain along the length, shadows, a 100 mm floor grid, orbit, zoom and pan, Iso, Front, Side and Top cameras, and Fit.
- Workbench layout: parts on the left, the 3D view with the cut list under it in the middle, the selected board on the right. On a phone the 3D view stays on top with Parts, Edit and Cut list tabs below.
- Parts that overlap are flagged in the list. Overlaps and snapping use each part's box (the rectangular blank around it), not its true outline, so a disc in the corner of another part's box counts as touching it.
- Cut list: identical parts of the same wood and shape are grouped. A shaped part lists the rectangular blank to cut it from, with its shape named under it (for example `Disc ⌀400` or `2 corners cut 50 × 80`); a dowel lists the rod, `⌀30 × 450`. Totals give the part count, volume, face area and approximate weight from the true shape, plus the overall size.
- Undo and redo (Ctrl+Z, Ctrl+Shift+Z). Rapid typing in one field counts as one step.
- Autosaves in the browser. Save and open a project as a `.woodplan.json` file. Files are format version 2; version 1 files and autosaves still open, every part as a board with square corners lying exactly as it did.
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
- Shapes: overlaps and snapping by the true outline instead of the box? Free polygons, or curves drawn by hand?
- Hosting: a page on maksforge.com, installable for offline use.

## Contributing

Woodworking planner is source-available, not open source: read it, verify it, file issues. Pull requests are not accepted — see [LICENSE](LICENSE).
