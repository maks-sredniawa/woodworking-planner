# Layout and visual directions

Three static mockups of the same project (the bookshelf starter template, "Upper shelf" selected). The 3D view is an inline SVG placeholder; the real app draws it with Three.js. Each direction follows the system light/dark setting.

| Direction | Mockup | 1280 × 900 | 360 × 800 |
| --- | --- | --- | --- |
| A · Workbench | `direction-a.html` | `direction-a-1280.png`, `direction-a-1280-dark.png` | `direction-a-360.png`, `direction-a-360-dark.png` |
| B · Drafting sheet | `direction-b.html` | `direction-b-1280.png`, `direction-b-1280-dark.png` | `direction-b-360.png`, `direction-b-360-dark.png` |
| C · Studio | `direction-c.html` | `direction-c-1280.png`, `direction-c-1280-dark.png` | `direction-c-360.png`, `direction-c-360-dark.png` |

## A · Workbench

**What it is.** A classic three-pane tool: parts list on the left, 3D view in the middle with the cut list docked under it, and a fixed inspector for the selected part on the right. Neutral greys, a teal accent for selection, monospace numerals. On a phone the 3D view stays pinned at the top and the three panes become tabs (Parts, Edit, Cut list) with an Add part bar at the bottom.

**Who it suits.** Someone who edits a lot of numbers and wants the list, the form, the model and the totals in sight together. Anyone who has used a CAD or design tool already knows where things are.

**Trade-offs.**
- Everything in version one is visible at 1280 × 900 without scrolling or opening anything.
- The 3D canvas is a plain rectangle that nothing overlaps, which is the simplest case for Three.js sizing and orbit controls.
- The 3D view is the smallest of the three (about 670 × 615 at 1280 × 900).
- It looks like a generic tool; it has the least character.
- On a phone, editing a part means switching tab, so the list is out of sight while editing.

## B · Drafting sheet

**What it is.** The page reads like a shop drawing. The 3D view sits in a ruled frame with a title block (boards, volume, surface, overall size, selection) and stays pinned while a single column beside it scrolls: a numbered parts schedule, where the selected row opens into its edit form in place, then the cut list. Blueprint-blue ink on pale paper, serif names, monospace dimensions; dark mode is an actual blueprint. Selection is a blue-tinted board with a heavy outline. On a phone it is the same column under a pinned sheet.

**Who it suits.** Someone who thinks of the plan as a document to read and print, and who works on one part at a time.

**Trade-offs.**
- The most distinctive look, and it needs no separate inspector: desktop and phone are the same structure, so there is the least layout code.
- The title block puts the totals on the drawing, where a woodworker expects them.
- The cut list starts below the fold at 900 px tall, and the list shifts when another row opens.
- The inline form is tight: six number fields in one row at 472 px.
- The title block covers a corner of the 3D view, so the camera has to frame the model away from it.
- Monospace and serif text is slower to scan than plain UI text in long lists.

## C · Studio

**What it is.** The 3D view fills the window and everything else floats over it as rounded cards: parts on the left, inspector on the right, cut list along the bottom, a small Import/Export pill. Soft grey studio backdrop, charcoal buttons, orange selection. On a phone the model takes the top half and a bottom sheet holds Parts, Edit and Cut list.

**Who it suits.** Someone who mostly wants to look at the render and show it to others, with editing second.

**Trade-offs.**
- The most attractive first impression, and the phone layout is the most natural of the three (bottom sheets are familiar).
- At 1280 wide the cards leave about 590 px of clear view, less than A, and the model can orbit behind a card.
- The cards need to collapse or hide to pay off, which is extra behaviour that version one does not otherwise need.
- Translucent cards over a moving WebGL canvas cost more to draw and are harder to keep readable.
- Orange selection on oak has the weakest contrast of the three.

## Recommendation: A · Workbench

Chosen for the first version on 2026-11-11. The app keeps a six-way "Lies" choice instead of the X/Y/Z toggle, which cannot say which way a board faces, and has no Quantity field: identical boards group in the cut list.

1. **It fits what version one is.** The work is typing dimensions and positions and checking the result. A is the only direction where list, form, model and cut list are all on screen at 1280 × 900, so the list-to-3D selection link and the live cut list are visible without any extra interaction.
2. **It is the least risky to build with plain HTML/CSS and Three.js.** One CSS grid, a canvas in an unobstructed cell, and no panels that open, collapse or float.
3. **It scales.** More parts, more fields per part, or a later second view all have an obvious place. B's inline form and C's floating cards both get crowded sooner.
4. **The phone version is honest.** Tabs under a pinned view show one thing at a time, which is all a 360 px screen can do well.

Its weakness is character. If the look matters more than density, B is the runner-up; its title block and its blueprint dark mode could later be borrowed into A without changing the layout. C is the one to pick only if the app turns out to be mostly a viewer.
