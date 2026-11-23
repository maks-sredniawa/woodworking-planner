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

- **Parts in 3D.** Each part has its size and its wood, and you see it with wood colour and grain.
  Add, copy, delete and edit them.
- **Millimetres or inches.** Pick the unit in the top bar. In inches every size is a fraction to the
  nearest 1/16 or 1/32 (`3 1/2`), and you can type `3 1/2`, `6' 3"` or `89mm` in any size field.
- **More than boards.** A part can be a board, a round disc, a dowel, a curved arc, a triangle or a
  free shape, and a board can have rounded or cut corners.
- **Free shapes.** Draw an outline point by point or in one freehand stroke, bend any edge into a
  curve, and fix it up in a drawing and a table of points side by side.
- **Place them by hand.** Drag a part along the floor or up and down, snap it flush against other
  parts, nudge it with the arrow keys, or turn it 90° at a time so it can face any way.
- **Catch mistakes by the true shape.** Parts that overlap are flagged, going by their real outline:
  a part sitting in the cut corner of another, or beside a disc, is not a clash, and parts that only
  touch are never flagged.
- **Join parts like the real thing.** Screw, nail, glue or pocket-screw two parts that touch, or fix
  them with an angle bracket, a mending plate or a corner plate. Joined parts move and turn together.
- **Cut joints.** House a part in a dado, give it a mortise and tenon, or dowel it. The parts stay
  where they are and the cut list makes them longer or wider by what goes into the joint.
- **Doors that open and stop.** Hang a door or lid on butt, concealed or piano hinges and drag it
  open. It stops at the first part in its way and tells you which.
- **Hardware list.** Hinges, brackets, plates, screws, pocket screws, nails and dowel pins are
  counted and sized from the parts they join, ready to take to the shop.
- **Cut list.** Identical parts of the same wood are grouped, each with the board size to cut it
  from, and totals for count, volume, face area, approximate weight and the overall size.
- **Cutting plan.** Lay every part onto boards and plywood sheets with saw kerf and edge trim,
  keeping the grain along the length, and see how many to buy and what is left over.
- **Lock what's finished.** A locked part can't be moved, turned, resized or deleted by mistake.
- **Undo and redo** with Ctrl+Z and Ctrl+Shift+Z.
- **Your project stays yours.** It saves itself in the browser, and you can save and open it as a
  `.woodplan.json` file.
- **Works on slow computers.** Potato mode draws with fewer details to keep the view smooth.

It opens with an example bookshelf to look around in.

## Known limitations

- In inches, the stock sizes in the cutting plan, the saw kerf, the suggested screw, plate and dowel
  sizes, the example bookshelf and the grid of the outline editor are still metric. They are shown
  in inches, rounded, with `≈` in front. You can type your own stock size.
- The unit is remembered by your browser, not saved in the project file.
- Joints are offered only between faces that meet square on, so two parts meeting on a slope, or a
  disc set inside a ring, are not offered for a joint. Two parts take one joint.
- A cut joint needs a board as the part that goes in.
- A free shape cannot have a hole.
- The cutting plan lays out the rectangle each part is cut from, so a free shape or a disc takes its
  whole box. Dowels are listed as rod, not laid out.

## Help and feedback

Found a bug or missing something? Email
**[woodworking.support@maksforge.com](mailto:woodworking.support@maksforge.com)**, or
[open an issue](https://github.com/maks-sredniawa/woodworking-planner/issues).

## Free, with an optional tip

The app is free. If it saves you a board or two, you can leave a tip on
[Buy Me a Coffee](https://buymeacoffee.com/maksforge).
