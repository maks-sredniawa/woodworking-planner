# Woodworking planner

Tool. A web app to plan a woodworking project and see it as a 3D render, all worked out on your own computer, before you cut the first board.

In development: the first version works locally, in the Workbench layout (direction A in `design/DESIGN.md`).

## What it's for

For anyone building furniture or other projects from boards and sheet goods: lay the parts out in 3D, catch mistakes such as boards that overlap, and get the cut list before buying wood or cutting anything. Nothing leaves your computer: no account and no server.

## First version

- A project is a name and a list of parts. Each part has a shape, its sizes in millimetres, the position of its left, bottom, back corner, which way it faces (one of the 24 ways a piece can point), and its wood.
- Five shapes: Board (length, width, thickness), Disc (diameter, thickness), Dowel (diameter, length), Arc (a ring segment: outer radius, band width, sweep in degrees, thickness) and Triangle (right-angled: length and width are the two legs, plus thickness). Switching shape keeps length, width and thickness, so switching back loses nothing.
- A board's corners can be square, rounded or cut: pick which of the four corners, then one radius, or for a cut how far it runs along the length and along the width. One treatment per board.
- Add, duplicate, delete and edit parts. Five equal buttons under Add a piece (Board, Disc, Dowel, Arc, Triangle; on a phone in the bar at the bottom) each add that shape in one press. A copy goes on the floor beside the original, past any part already there. Clicking a part in the 3D view picks it in the list and the other way round. The list shows each part's outline in its wood colour.
- Move a board by dragging it in the 3D view once it is picked. Floor or Height in the toolbar picks whether it slides along the floor or goes up and down; holding Shift switches mid-drag and letting go switches back, so one drag can slide, lift and slide again. With Snap on (remembered per browser) it sits flush where it would meet another piece along the way it is dragged, by the true outlines (on a curve, the first point where they touch), lines up with the faces of pieces out of its way, or sits on a 10 mm grid. Any piece of a dragged assembly can be the one that sits flush, an open door where it stands, and lifting stops the assembly's lowest piece on the floor. Holding Alt does the opposite, also mid-drag. Arrow keys nudge it 10 mm, Shift+arrow 1 mm, Alt+↑/↓ back and forth. A whole drag is one undo step.
- Join two pieces that touch with screws, nails, glue, an angle bracket or a hinge (Joints in the edit panel; the To list offers only pieces whose true outlines meet on a face, so a disc in the corner of a board's box is not offered). One joint per pair; screws, nails and brackets can also be glued. Joined pieces form an assembly: dragging, nudging, typing a position or Turn, Tip and Roll moves the whole assembly, and Delete removes the piece's joints with it.
- A hinged piece swings on one edge of the face it shares with its frame (Left, Right, Top, Bottom, Back or Front edge; the edge nearest the frame by default), away from the frame. Dragging it in the 3D view swings it to any angle up to its limit (5° steps with Snap, catching 0°, 90° and the limit); dragging the frame moves both. Open angle, a slider, Close and Open fully sit in the joint. Positions are kept as if every hinge were closed, but snapping and the ±10,000 mm position limit go by where an open door actually stands. A piece swings on only one hinge, nothing can be joined to a piece while its hinge is open, and a hinge whose door is also fixed to its frame some other way can't swing and says why. The swing is not stopped by other pieces; any it passes through are flagged as overlapping, using the swung piece's true outline at its angle.
- Each joint has sizes worked out from the pieces it joins, which can be changed and reset with Use suggested sizes: screws and nails (count, diameter, length, about 2.5 times the piece they go through, never longer than both pieces), angle brackets (count, leg, width, screws for each bracket; a bracket needs an inside corner) and hinges (butt, concealed with a 35 mm cup, or piano; count by door height, length, screws each and their size, how far it opens). Warnings flag a joint whose pieces no longer touch, a screw longer than both pieces, and concealed hinges on a door under 16 mm thick.
- The 3D view draws the hardware: hinge knuckles on the hinge line (a concealed hinge has a short one on the frame beside each cup), screw and nail heads on the outside face, brackets in the inside corner, and the picked door's hinge line in the accent colour.
- Hardware list under the cut list: hinges, brackets, screws (including those for brackets and hinges) and nails, grouped by size with where they are used, plus glued joints, and a hardware count in the totals.
- Lock a board in place (edit panel or its row in the list): a locked board can't be dragged, nudged, rotated, resized or deleted, and a drag that starts on it turns the view instead. A locked piece pins every piece joined to it (position, Lies and turning are off for all of them), but a door hinged on it can still swing. A locked door stays at its angle, and so does an open door with a locked piece fixed to it: changing how far it opens, the hinge type or edge, or Use suggested sizes is refused when it would swing it, and so are resizing or reshaping the piece it hangs on, removing its hinge and deleting that piece. Remove joint and Delete look off, and pressing them (or the Delete key) says which locked piece is in the way, as does the field you changed. Its name and wood can still change, the lock is saved with the project, and a copy of it starts unlocked.
- Turn, Tip and Roll rotate the picked piece 90° (keys R, T, L), so a triangle, an arc or a board with some corners shaped can face any of the 24 ways. It turns about the middle of its footprint and keeps its underside where it was, so a piece on the floor or on another piece stays resting there, however often it is turned. Two turns about the same axis face it the other way; four bring it back. The Lies list sets the six main ways directly, for the picked piece only: on a joined piece it can pull that piece off its joints, while Turn, Tip and Roll turn the whole assembly; any other way shows as the nearest of the six plus how it is turned (for example `Lying flat, length front–back, spun half a turn`).
- The 3D view redraws only when something changes, so an idle page leaves the GPU alone.
- Potato (top bar, remembered per browser) draws faster on slow computers: 1× pixels, no shadows, flat colours without grain and simpler lighting. Boards keep their wood colour, which costs nothing. On a software renderer at 2× pixel density, turning the view went from 18–29 to 60 frames a second.
- Debug (top bar) shows the graphics card in use, frames per second, GPU time per frame where the browser allows measuring it, and the app's CPU time. A web page cannot read the whole computer's GPU or CPU load, so these are the app's own share.
- 3D view with wood colours and grain along the length, shadows, a 100 mm floor grid, orbit, zoom and pan, Iso, Front, Side and Top cameras, and Fit.
- Workbench layout: parts on the left, the 3D view with the cut list under it in the middle, the selected board on the right. On a phone the 3D view stays on top with Parts, Edit and Cut list tabs below.
- Parts that overlap are flagged in the list, by their true solid rather than their box: rounded and cut corners, discs, round dowels, the bend of an arc and the slope of a triangle, in any of the 24 poses and on a swung piece at any angle. Curves are checked as polygons within 0.4 mm of the true curve that never reach past it, so pieces that only touch are never flagged, and a piece in the empty corner of another's box neither overlaps nor touches it.
- Cut list: identical parts of the same wood and shape are grouped. A shaped part lists the rectangular blank to cut it from, with its shape named under it (for example `Disc ⌀400` or `2 corners cut 50 × 80`); a dowel lists the rod, `⌀30 × 450`. Totals give the part count, volume, face area and approximate weight from the true shape, plus the overall size.
- Undo and redo (Ctrl+Z, Ctrl+Shift+Z). Rapid typing in one field counts as one step; each tick, choice or list pick is a step of its own.
- Autosaves in the browser. Save and open a project as a `.woodplan.json` file. Files are format version 3, which adds joints; version 1 and 2 files and autosaves still open, with no joints, and version 1 parts as boards with square corners lying exactly as they did.
- Opens with an example bookshelf; New starts an empty project and Example brings the bookshelf back.

## Run it

```bash
npm start
```

Then open http://127.0.0.1:8777/. There is no build step. The app lives in `docs/app/`, which maksforge.com serves at `/woodworking-planner/app/`; the rest of `docs/` is its page there. three.js is vendored in `docs/app/vendor/three/` (0.180.0, MIT), with one change: `addons/OrbitControls.js` imports `../three.module.js` instead of the bare name `three`, because the site's Content-Security-Policy blocks an inline import map.

A service worker (`docs/app/sw.js`) keeps a copy of every app file so it works offline after the first visit, and `manifest.webmanifest` makes it installable. `tests/offline.test.js` fails when a file is added without being listed in `sw.js`; bump its `CACHE` name whenever the app changes. The worker fetches from the network first, so visitors online already get new files; the bump refreshes the offline copy and clears files that were removed.

## Tests

```bash
npm test
```

```bash
uv run --with playwright python tests/browser/ui_test.py
```

## Open questions

- Units: millimetres only, or inches and fractions as well?
- Cut joinery: should parts know about dados, tenons and dowel joints so lengths and the cut list account for them?
- Joints: mending and corner plates, pocket screws, and a door stopped by what it swings into?
- Sheet goods: a cutting plan that nests parts onto standard boards or plywood sheets, with saw kerf?
- Shapes: free polygons, or curves drawn by hand?

## Contributing

Woodworking planner is source-available, not open source: read it, verify it, file issues. Pull requests are not accepted — see [LICENSE](LICENSE).
