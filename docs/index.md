---
layout: default
title: Woodworking planner
---

# Woodworking planner

**A free web app to plan a woodworking project and see it in 3D before you cut the first board.**
Everything is worked out on your own computer: no account and no online server.

## Try it

**[Open the planner](app/)**. It runs in your browser: the page is sent to you once, and everything
after that is worked out on your own computer. After the first visit it also works offline, and your
browser can install it like an app (look for Install in its menu or address bar).

## What it's for

For anyone building furniture or other projects from boards and sheet goods: lay the parts out in
3D, catch mistakes such as boards that overlap, and get the cut list before buying wood or cutting
anything.

## What it does

- **Parts in 3D.** Each part has its size in millimetres and its wood, and you see it with wood
  colour and grain. Add, copy, delete and edit them.
- **More than boards.** A part can be a board, a round disc, a dowel, a curved arc or a triangle,
  and a board can have rounded or cut corners.
- **Place them by hand.** Drag a part along the floor or up and down, snap it flush against other
  parts, nudge it with the arrow keys, or turn it 90° at a time so it can face any way.
- **Join parts like the real thing.** Screw, nail, glue or bracket two parts that touch, or hang
  a door or lid on hinges. Joined parts move and turn together, and a hinged part swings open to
  any angle when you drag it.
- **Hardware list.** Hinges, angle brackets, screws and nails are counted and sized from the
  parts they join, ready to take to the shop.
- **Lock what's finished.** A locked part can't be moved, turned, resized or deleted by mistake.
- **Catch mistakes.** Parts that overlap are flagged in the list.
- **Cut list.** Identical parts of the same wood are grouped, each with the board size to cut it
  from (dowels as rod), and totals for count, volume, face area, approximate weight and the overall
  size.
- **Undo and redo** with Ctrl+Z and Ctrl+Shift+Z.
- **Your project stays yours.** It saves itself in the browser, and you can save and open it as a
  `.woodplan.json` file.
- **Works on slow computers.** Potato mode draws with fewer details to keep the view smooth.

It opens with an example bookshelf to look around in.

## Known limitations

- Millimetres only, for now.
- No cut joints yet (dados, tenons), and a swinging door is not stopped by parts in its way:
  they are flagged as overlapping instead.
- Overlaps and snapping use each part's bounding box, so round or angled parts can be flagged as
  overlapping when their boxes overlap even though the parts themselves don't touch.
- No cutting plan that fits parts onto standard boards or plywood sheets.

## Help and feedback

Found a bug or missing something? Email
**[woodworking.support@maksforge.com](mailto:woodworking.support@maksforge.com)**, or
[open an issue](https://github.com/maks-sredniawa/woodworking-planner/issues).

## Free, with an optional tip

The app is free. If it saves you a board or two, you can leave a tip on
[Buy Me a Coffee](https://buymeacoffee.com/maksforge).
