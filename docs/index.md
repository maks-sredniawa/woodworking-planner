---
layout: default
title: Woodworking planner
---

# Woodworking planner

**A free web app to plan a woodworking project and see it in 3D before you cut the first board.**
Everything is worked out on your own computer: no account, no server.

In development: not hosted yet. To try it, run it locally from the
[source](https://github.com/maks-sredniawa/woodworking-planner): `npm start` serves it at
`http://127.0.0.1:8777/` (it needs Node.js and Python 3). There is no build step, and it works
offline.

## What it's for

For anyone building furniture or other projects from boards and sheet goods: lay the parts out in
3D, catch mistakes such as boards that overlap, and get the cut list before buying wood or cutting
anything.

## What it does

- **Boards in 3D.** Each part is a rectangular board with its length, width, thickness (in
  millimetres) and wood. Add, copy, delete and edit them, and see them with wood colour and grain.
- **Place them by hand.** Drag a board along the floor or up and down, snap it flush against other
  boards, nudge it with the arrow keys, or turn it 90° at a time.
- **Lock what's finished.** A locked board can't be moved, turned, resized or deleted by mistake.
- **Catch mistakes.** Boards that overlap are flagged in the list.
- **Cut list.** Identical boards of the same wood are grouped, with the board count, volume, face
  area, approximate weight and the overall size.
- **Undo and redo** with Ctrl+Z and Ctrl+Shift+Z.
- **Your project stays yours.** It saves itself in the browser, and you can save and open it as a
  `.woodplan.json` file.
- **Works on slow computers.** Potato mode draws with fewer details to keep the view smooth.

It opens with an example bookshelf to look around in.

## Coming next

Curved and round pieces, beyond rectangular boards.

## Known limitations

- Millimetres only, for now.
- Every part is a rectangular board: no joints (dados, tenons, dowels) and no angled cuts yet.
- No cutting plan that fits parts onto standard boards or plywood sheets.

## Help and feedback

Found a bug or missing something? [Open an issue](https://github.com/maks-sredniawa/woodworking-planner/issues).

## Free, with an optional tip

The app is free. If it saves you a board or two, you can leave a tip on
[Buy Me a Coffee](https://buymeacoffee.com/maksforge).
