import re
import socket
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    PORT = probe.getsockname()[1]
URL = f'http://127.0.0.1:{PORT}/index.html'

server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
errors = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True, args=['--enable-unsafe-swiftshader'])
        for width, height in [(1280, 900), (360, 800)]:
            page = browser.new_page(viewport={'width': width, 'height': height})
            page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(URL)
            expect(page.locator('#parts li')).to_have_count(7)
            expect(page.locator('#totals')).to_contain_text('7 boards')
            expect(page.locator('#overall')).to_contain_text('800 wide × 1,000 high × 250 deep')
            page.wait_for_timeout(600)
            page.screenshot(path=str(HERE / f'start-{width}.png'), full_page=True)
            assert page.evaluate('document.documentElement.scrollWidth') <= width, 'horizontal scroll'

            if width == 360:
                page.click('.tabs [data-tab=cut]')
                expect(page.locator('#totals')).to_be_visible()
                expect(page.locator('#parts')).to_be_hidden()
                page.click('#menu-toggle')
                expect(page.locator('#save-file')).to_be_visible()
                page.screenshot(path=str(HERE / 'menu-360.png'))
                page.click('#starter')
                expect(page.locator('#save-file')).to_be_hidden()
                page.click('#add-phone')
                expect(page.locator('#editor')).to_be_visible()
                expect(page.locator('#view-sel')).to_contain_text('Board')
                page.wait_for_timeout(400)
                page.screenshot(path=str(HERE / 'edit-360.png'), full_page=True)

            if width == 1280:
                for name in ['front', 'side', 'top', 'iso']:
                    page.click(f'.view-tools [data-view={name}]')
                    page.wait_for_timeout(250)
                    if name == 'front':
                        page.screenshot(path=str(HERE / 'front-1280.png'))
                expect(page.locator('.view-tools [data-view=iso]')).to_have_attribute('aria-pressed', 'true')
                box = page.locator('#viewport canvas').bounding_box()
                page.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
                expect(page.locator('#editor')).to_be_visible()
                expect(page.locator('#view-sel')).to_be_visible()
                expect(page.locator('.row.sel .row-acts button')).to_have_count(3)
                picked = page.evaluate('woodworkingPlanner.project.parts.find(p => document.getElementById("part-" + p.id).querySelector("[aria-pressed=true]"))?.name')
                assert picked, 'clicking the 3D view did not select a board'

                page.locator('#parts li').nth(4).locator('.row-main').click()
                page.fill('#editor [name=y]', '10')
                expect(page.locator('#parts li').nth(4)).to_contain_text('Overlaps')
                page.keyboard.press('Escape')
                page.keyboard.press('Control+z')
                expect(page.locator('.warn')).to_have_count(0)

                page.click('#add')
                expect(page.locator('#parts li')).to_have_count(8)
                page.fill('#editor [name=length]', '-3')
                expect(page.locator('#editor [name=length]')).to_have_attribute('aria-invalid', 'true')
                page.click('#duplicate')
                expect(page.locator('#parts li')).to_have_count(9)
                page.wait_for_timeout(400)
                page.screenshot(path=str(HERE / 'edited-1280.png'))

                page.reload()
                expect(page.locator('#parts li')).to_have_count(9)
                page.locator('#parts li').last.locator('.row-main').click()
                page.click('#delete')
                expect(page.locator('#parts li')).to_have_count(8)
                with page.expect_download() as download:
                    page.click('#save-file')
                assert download.value.suggested_filename == 'small-bookshelf.woodplan.json'
                saved = HERE / 'saved.json'
                download.value.save_as(saved)
                page.click('#new-project')
                expect(page.locator('#parts li')).to_have_count(0)
                page.set_input_files('#file-input', str(saved))
                expect(page.locator('#parts li')).to_have_count(8)
                saved.unlink()
                bad = HERE / 'bad.json'
                bad.write_text('{"format":"nope"}')
                page.set_input_files('#file-input', str(bad))
                expect(page.locator('#file-error')).to_contain_text('not a Woodworking planner project')
                bad.unlink()
            page.close()

        page = browser.new_page(viewport={'width': 1280, 'height': 900})
        page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(URL)
        expect(page.locator('#parts li')).to_have_count(7)
        part = lambda: page.evaluate('(() => { const p = woodworkingPlanner.project.parts[0]; return { x: p.x, y: p.y, z: p.z } })()')
        box = page.locator('#viewport canvas').bounding_box()
        cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
        page.mouse.click(cx, cy)
        expect(page.locator('.row.sel .nm')).to_have_text('Back panel')
        start = part()

        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + 160, cy + 10, steps=10)
        page.mouse.up()
        moved = part()
        assert moved['x'] > start['x'] + 50 and moved['y'] == start['y'], f'drag did not move along the floor: {moved}'
        assert moved['x'] % 10 == 0 or moved['x'] in (18, 800), f'drag did not snap: {moved}'
        expect(page.locator('#editor [name=x]')).to_have_value(str(int(moved['x'])) if moved['x'] == int(moved['x']) else str(moved['x']))

        page.keyboard.down('Shift')
        page.mouse.move(cx + 270, cy)
        page.mouse.down()
        page.mouse.move(cx + 270, cy - 100, steps=10)
        page.mouse.up()
        page.keyboard.up('Shift')
        lifted = part()
        assert lifted['y'] > 50 and lifted['x'] == moved['x'], f'Shift-drag did not lift the board: {lifted}'

        page.keyboard.press('Control+z')
        assert part() == moved, 'one undo should take back the whole lift'
        page.keyboard.press('Control+z')
        assert part() == start, 'one undo should take back the whole drag'

        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + 80, cy, steps=6)
        slid = part()
        assert slid['x'] > start['x'] and slid['y'] == start['y'], f'first leg should slide along the floor: {slid}'
        expect(page.locator('#mode-floor')).to_have_attribute('aria-pressed', 'true')
        page.keyboard.down('Shift')
        expect(page.locator('#mode-height')).to_have_attribute('aria-pressed', 'true')
        page.mouse.move(cx + 80, cy - 90, steps=6)
        raised = part()
        assert raised['y'] > 50 and raised['x'] == slid['x'] and raised['z'] == slid['z'], f'holding Shift mid-drag should lift: {raised}'
        page.keyboard.up('Shift')
        expect(page.locator('#mode-floor')).to_have_attribute('aria-pressed', 'true')
        page.mouse.move(cx + 140, cy - 90, steps=6)
        again = part()
        assert again['y'] == raised['y'] and again['x'] > raised['x'], f'releasing Shift should slide again at the new height: {again}'
        page.keyboard.down('Alt')
        expect(page.locator('#snap')).to_have_attribute('aria-pressed', 'false')
        page.mouse.move(cx + 163, cy - 87, steps=6)
        page.keyboard.up('Alt')
        expect(page.locator('#snap')).to_have_attribute('aria-pressed', 'true')
        page.mouse.up()
        page.keyboard.press('Control+z')
        assert part() == start, f'the whole mixed drag should undo in one step: {part()}'

        page.keyboard.press('ArrowRight')
        page.keyboard.press('ArrowRight')
        page.keyboard.press('Shift+ArrowUp')
        page.keyboard.press('Alt+ArrowDown')
        assert part() == {'x': start['x'] + 20, 'y': start['y'] + 1, 'z': start['z'] + 10}, part()
        page.keyboard.press('Control+z')
        assert part() == start, 'quick nudges undo in one step'

        page.click('#lock')
        expect(page.locator('#lock')).to_have_attribute('aria-pressed', 'true')
        expect(page.locator('.row.sel')).to_contain_text('Locked')
        expect(page.locator('#editor [name=x]')).to_be_disabled()
        expect(page.locator('#editor [name=pose]')).to_be_disabled()
        expect(page.locator('#delete')).to_be_disabled()
        expect(page.locator('[data-rotate=y]')).to_be_disabled()
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + 150, cy, steps=8)
        page.mouse.up()
        page.keyboard.press('ArrowRight')
        page.keyboard.press('r')
        page.keyboard.press('Delete')
        assert part() == start, f'a locked board moved: {part()}'
        expect(page.locator('#parts li')).to_have_count(7)
        page.fill('#editor [name=name]', 'Fixed back')
        expect(page.locator('.row.sel .nm')).to_have_text('Fixed back')
        page.fill('#editor [name=name]', 'Back panel')
        page.reload()
        page.click('.view-tools [data-view=iso]')
        page.mouse.click(cx, cy)
        expect(page.locator('#lock')).to_have_attribute('aria-pressed', 'true')
        page.click('#lock')
        expect(page.locator('#editor [name=x]')).to_be_enabled()
        page.keyboard.press('ArrowRight')
        assert part()['x'] == start['x'] + 10, f'unlocked board should move again: {part()}'
        page.keyboard.press('Control+z')

        page.wait_for_timeout(500)
        idle = page.evaluate('woodworkingPlanner.framesDrawn()')
        page.wait_for_timeout(1000)
        assert page.evaluate('woodworkingPlanner.framesDrawn()') == idle, 'the 3D view keeps redrawing while nothing changes'

        page.click('#mode-height')
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx, cy - 100, steps=10)
        page.mouse.up()
        assert part()['y'] > 50 and part()['x'] == start['x'], f'Height mode did not lift the board: {part()}'
        page.keyboard.press('Control+z')
        page.click('#mode-floor')

        page.click('#snap')
        expect(page.locator('#snap')).to_have_attribute('aria-pressed', 'false')
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + 137, cy + 3, steps=10)
        page.mouse.up()
        assert part()['x'] % 10 != 0, f'with Snap off the board should land between grid lines: {part()}'
        page.keyboard.press('Control+z')
        page.reload()
        expect(page.locator('#snap')).to_have_attribute('aria-pressed', 'false')
        page.click('#snap')
        expect(page.locator('#snap')).to_have_attribute('aria-pressed', 'true')

        expect(page.locator('[data-rotate=y]')).to_be_disabled()
        page.locator('#parts li').nth(4).locator('.row-main').click()
        shelf = lambda: page.evaluate('(() => { const p = woodworkingPlanner.project.parts[4]; return [p.pose, p.y] })()')
        lies = page.locator('#editor [name=pose]')
        page.click('[data-rotate=y]')
        assert shelf()[0] == '-z-x+y', shelf()
        expect(lies).to_have_value('-z-x+y')
        expect(lies.locator('option:checked')).to_have_text('Lying flat, length front–back, spun half a turn')
        expect(lies.locator('option')).to_have_count(7)
        expect(page.locator('#pose-note')).to_have_text('Spun half a turn from “Lying flat, length front–back”.')
        page.keyboard.press('r')
        assert shelf()[0] == '-x+z+y', f'two turns should face the board the other way: {shelf()}'
        page.click('[data-rotate=x]')
        assert shelf()[0] == '-x-y+z', shelf()
        page.wait_for_timeout(300)
        page.screenshot(path=str(HERE / 'tipped-1280.png'))
        page.keyboard.press('Control+z')
        assert shelf()[0] == '-x+z+y', f'one undo should take back only the Tip: {shelf()}'
        page.keyboard.press('Control+z')
        assert shelf()[0] == '-z-x+y', f'each rotation is its own undo step: {shelf()}'
        lies.select_option('+z+x+y')
        assert shelf()[0] == '+z+x+y', shelf()
        expect(lies.locator('option')).to_have_count(6)
        expect(page.locator('#pose-note')).to_be_hidden()
        expect(lies.locator('option:checked')).to_have_text('Lying flat, length front–back')
        page.keyboard.press('Control+z')
        assert shelf()[0] == '-z-x+y', shelf()

        assert page.evaluate('document.querySelector(".bar").getBoundingClientRect().height') < 60, 'top bar wrapped onto two rows'
        page.click('#potato-toggle')
        expect(page.locator('#potato-toggle')).to_have_attribute('aria-pressed', 'true')
        page.reload()
        expect(page.locator('#potato-toggle')).to_have_attribute('aria-pressed', 'true')
        page.mouse.click(cx, cy)
        expect(page.locator('.row.sel .nm')).to_have_text('Back panel')
        page.click('#potato-toggle')
        expect(page.locator('#potato-toggle')).to_have_attribute('aria-pressed', 'false')
        expect(page.locator('.row.sel .nm')).to_have_text('Back panel')

        expect(page.locator('#debug')).to_be_hidden()
        page.click('#debug-toggle')
        expect(page.locator('#debug')).to_contain_text('Graphics')
        expect(page.locator('#debug')).to_contain_text('CPU 3D')
        page.reload()
        expect(page.locator('#debug')).to_be_visible()
        page.wait_for_timeout(2300)
        expect(page.locator('#debug')).to_contain_text('0 per second')
        debug_text = page.inner_text('#debug')
        page.locator('#parts li').nth(3).locator('.row-main').click()
        before = part()
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx - 200, cy, steps=8)
        page.mouse.up()
        assert part() == before, 'dragging an unpicked board must turn the view, not move anything'
        page.wait_for_timeout(300)
        page.screenshot(path=str(HERE / 'moved-1280.png'))
        page.wait_for_timeout(1100)
        expect(page.locator('#debug')).not_to_contain_text(' 0 per second')
        page.click('#debug-toggle')
        expect(page.locator('#debug')).to_be_hidden()
        print(debug_text)
        page.close()

        page = browser.new_page(viewport={'width': 1280, 'height': 900})
        page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(URL)
        expect(page.locator('#parts li')).to_have_count(7)
        focused = lambda: page.evaluate('document.activeElement.dataset.focus || document.activeElement.id || document.activeElement.tagName')
        part_id = lambda n: page.evaluate(f'woodworkingPlanner.project.parts[{n}].id')
        count = lambda: page.evaluate('woodworkingPlanner.project.parts.length')

        expect(page.locator('#viewport canvas')).to_have_attribute('role', 'img')
        expect(page.locator('#viewport canvas')).to_have_attribute('aria-label', re.compile(r'7 boards, 800 wide × 1,000 high × 250 deep'))
        assert page.get_attribute('.view', 'aria-label') is None, 'the label belongs on the canvas, not the role-less div'

        page.locator('#parts li').nth(2).locator('.row-main').focus()
        page.keyboard.press('Enter')
        assert focused() == f'main:{part_id(2)}', f'Enter on a row dropped focus to {focused()}'
        page.keyboard.press('Tab')
        assert focused() == f'lock:{part_id(2)}', focused()
        page.keyboard.press('Enter')
        assert focused() == f'lock:{part_id(2)}', f'Lock dropped focus to {focused()}'
        page.keyboard.press('Enter')
        page.keyboard.press('Tab')
        page.keyboard.press('Enter')
        assert count() == 8 and focused() == f'main:{part_id(3)}', f'after Duplicate focus went to {focused()}'
        copied = page.evaluate('(() => { const p = woodworkingPlanner.project.parts[3]; return [p.x, p.y, p.z] })()')
        assert copied == [850, 0, 6], f'the copy should stand on the floor beside the side panel: {copied}'
        expect(page.locator('.warn')).to_have_count(0)
        page.keyboard.press('Tab')
        page.keyboard.press('Tab')
        page.keyboard.press('Tab')
        assert focused() == f'delete:{part_id(3)}', focused()
        page.keyboard.press('Enter')
        assert count() == 7 and focused() == f'main:{part_id(3)}', f'after Delete focus went to {focused()}'
        page.keyboard.press('Enter')
        page.keyboard.press('Tab')
        page.keyboard.press('Escape')
        assert focused() == f'main:{part_id(3)}', f'Escape on a row button dropped focus to {focused()}'

        page.locator('#parts li').nth(3).locator('.row-main').click()
        page.click('#editor [name=name]')
        page.keyboard.press('Escape')
        expect(page.locator('#editor')).to_be_hidden()
        assert focused() == f'main:{part_id(3)}', f'Escape in the editor dropped focus to {focused()}'
        page.locator('#parts li').nth(3).locator('.row-main').click()
        page.click('#delete')
        assert count() == 6 and focused() == f'main:{part_id(3)}', f'the editor Delete dropped focus to {focused()}'
        page.keyboard.press('Control+z')

        page.locator('#parts li').nth(3).locator('.row-main').click()
        for field in ['#field-species', '#field-pose']:
            page.focus(field)
            page.keyboard.press('Delete')
            page.keyboard.press('Backspace')
        assert count() == 7, 'Delete or Backspace in a Wood or Lies list deleted the board'

        shelf_turn = lambda: page.evaluate('woodworkingPlanner.project.parts[3].pose')
        page.focus('#editor [name=name]')
        page.keyboard.press('Escape')
        page.locator('#parts li').nth(3).locator('.row-main').click()
        page.focus('#lock')
        page.keyboard.press('r')
        page.focus('#field-species')
        page.keyboard.press('t')
        page.evaluate('document.activeElement.blur()')
        page.keyboard.press('l')
        assert shelf_turn() == '+x-z+y', f'R, T or L acted outside the 3D view and parts list: {shelf_turn()}'
        box = page.locator('#viewport canvas').bounding_box()
        page.mouse.click(box['x'] + 30, box['y'] + box['height'] - 30)
        page.locator('#parts li').nth(3).locator('.row-main').click()
        page.keyboard.press('r')
        assert shelf_turn() == '-z-x+y', f'R on the parts list did not turn the board: {shelf_turn()}'
        page.focus('#viewport canvas')
        page.keyboard.press('r')
        assert shelf_turn() == '-x+z+y', f'R in the 3D view did not turn the board: {shelf_turn()}'
        page.keyboard.press('Control+z')
        page.keyboard.press('Control+z')

        page.click('#lock')
        page.focus('#viewport canvas')
        page.keyboard.press('r')
        page.keyboard.press('Control+z')
        expect(page.locator('#lock')).to_have_attribute('aria-pressed', 'false')
        expect(page.locator('#redo')).to_be_enabled()

        page.fill('#editor [name=length]', '-3')
        expect(page.locator('#length-error')).to_be_visible()
        expect(page.locator('#length-error')).to_have_attribute('aria-live', 'polite')
        expect(page.locator('#length-error')).to_contain_text('above 0')
        expect(page.locator('#editor [name=length]')).to_have_attribute('aria-describedby', 'length-error')
        page.fill('#editor [name=x]', '20000')
        expect(page.locator('#x-error')).to_contain_text('10,000')
        page.fill('#editor [name=length]', '700')
        expect(page.locator('#length-error')).to_be_hidden()
        assert page.get_attribute('#editor [name=length]', 'aria-describedby') is None
        page.keyboard.press('Control+z')

        page.focus('#parts li >> nth=0 >> .row-main')
        page.keyboard.press('Shift+Tab')
        page.focus('#snap')
        ring = page.evaluate('(() => { const s = getComputedStyle(document.getElementById("snap")); return [s.outlineStyle, s.outlineOffset] })()')
        assert ring == ['solid', '-2px'], f'the Snap focus ring is drawn outside its clipped group: {ring}'

        def contrast(a, b):
            def lum(rgb):
                vals = [int(v) / 255 for v in re.findall(r'\d+', rgb)[:3]]
                vals = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in vals]
                return 0.2126 * vals[0] + 0.7152 * vals[1] + 0.0722 * vals[2]
            hi, lo = sorted([lum(a), lum(b)], reverse=True)
            return (hi + 0.05) / (lo + 0.05)
        panel = page.evaluate('getComputedStyle(document.querySelector(".bar")).backgroundColor')
        for field in ['#project-name', '#editor [name=length]', '#field-species']:
            edge = page.evaluate(f'getComputedStyle(document.querySelector("{field}")).borderTopColor')
            assert contrast(edge, panel) >= 3, f'{field} border {edge} is {contrast(edge, panel):.2f}:1 on {panel}'

        page.click('#debug-toggle')
        expect(page.locator('#debug')).to_contain_text('Graphics')
        assert 'NaN' not in page.inner_text('#debug'), page.inner_text('#debug')
        page.wait_for_timeout(1200)
        assert 'NaN' not in page.inner_text('#debug'), page.inner_text('#debug')
        page.click('#debug-toggle')

        unreadable = '{"format":"woodworking-planner","version":1,"parts":[{"length":600,"x":10050}]}'
        page.evaluate(f'localStorage.setItem("woodworking-planner:project", {unreadable!r})')
        page.reload()
        expect(page.locator('#file-error')).to_be_visible()
        expect(page.locator('#file-error')).to_contain_text('could not be opened')
        expect(page.locator('#file-error')).to_contain_text('Part 1 has an invalid x')
        stored = page.evaluate('[localStorage.getItem("woodworking-planner:project"), localStorage.getItem("woodworking-planner:unreadable-project")]')
        assert stored == [unreadable, unreadable], f'the unreadable save was overwritten: {stored}'
        page.click('#add')
        assert page.evaluate('localStorage.getItem("woodworking-planner:unreadable-project")') == unreadable
        page.evaluate('localStorage.clear()')
        page.close()

        phone = browser.new_page(viewport={'width': 360, 'height': 800})
        phone.on('console', lambda m: m.type == 'error' and errors.append(m.text))
        phone.on('pageerror', lambda e: errors.append(str(e)))
        phone.goto(URL)
        expect(phone.locator('#parts li')).to_have_count(7)
        order = phone.evaluate('''[".view", ".tabs", ".parts", ".cut", ".inspector"].map((s) => document.querySelector(s))
            .every((node, i, all) => i === 0 || all[i - 1].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)''')
        assert order, 'the DOM does not follow the phone order: view, tabs, panels'

        phone.focus('#menu-toggle')
        phone.keyboard.press('Enter')
        expect(phone.locator('#starter')).to_be_visible()
        phone.focus('#starter')
        phone.keyboard.press('Enter')
        expect(phone.locator('#starter')).to_be_hidden()
        assert phone.evaluate('document.activeElement.id') == 'menu-toggle', 'closing the menu from inside lost focus'

        phone.focus('.tabs [data-tab=parts]')
        for n in range(7):
            phone.keyboard.press('Tab')
            covered = phone.evaluate('''(() => {
                const el = document.activeElement, r = el.getBoundingClientRect();
                const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                return el.contains(hit) ? null : `${el.dataset.focus} under ${hit?.className}`;
            })()''')
            assert covered is None, f'a focused row is hidden: {covered}'

        phone.click('#add-more-phone')
        expect(phone.locator('#add-menu-phone')).to_be_visible()
        menu = phone.locator('#add-menu-phone').bounding_box()
        bar = phone.locator('#add-more-phone').bounding_box()
        assert menu['y'] + menu['height'] <= bar['y'], f'the phone menu does not open upward: {menu} {bar}'
        phone.click('#add-menu-phone [data-add-shape=dowel]')
        expect(phone.locator('.tabs [data-tab=edit]')).to_have_attribute('aria-pressed', 'true')
        expect(phone.locator('#view-sel')).to_contain_text('⌀30 × 450 dowel')
        expect(phone.locator('#cut-from')).to_have_text('Cut from ⌀30 × 450 dowel rod')
        phone.click('.tabs [data-tab=cut]')
        expect(phone.locator('#cut-rows')).to_contain_text('Dowel rod')
        assert phone.evaluate('document.documentElement.scrollWidth') <= 360, 'horizontal scroll with a dowel'
        phone.keyboard.press('Control+z')

        status = phone.evaluate('getComputedStyle(document.getElementById("save-state")).display')
        assert status != 'none', 'the save status is removed on phones'
        phone.evaluate('() => { Storage.prototype.setItem = () => { throw new Error("full") }; }')
        phone.click('#add-phone')
        expect(phone.locator('#save-state')).to_have_text('Could not save in this browser')
        size = phone.locator('#save-state').bounding_box()
        assert size and size['width'] > 50 and size['height'] > 8, f'the save failure is not shown on phones: {size}'
        phone.close()

        zoomed = browser.new_page(viewport={'width': 320, 'height': 256})
        zoomed.on('pageerror', lambda e: errors.append(str(e)))
        zoomed.goto(URL)
        expect(zoomed.locator('#parts li')).to_have_count(7)
        inside = zoomed.evaluate('''(() => {
            const view = document.querySelector(".view").getBoundingClientRect();
            return [".view-tools", ".move-tools"].every((s) => {
                const r = document.querySelector(s).getBoundingClientRect();
                return r.top >= view.top && r.bottom <= view.bottom;
            });
        })()''')
        assert inside, 'at 320 × 256 the camera or move tools sit outside the 3D view'
        zoomed.locator('#parts li').last.locator('.row-main').click()
        for tab, last in [('parts', '#parts li:last-child .row-main'), ('edit', '#delete'), ('cut', '#totals')]:
            zoomed.click(f'.tabs [data-tab={tab}]')
            reachable = zoomed.evaluate(f'''(() => {{
                const el = document.querySelector("{last}");
                el.scrollIntoView({{ block: "center" }});
                const r = el.getBoundingClientRect();
                return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
            }})()''')
            assert reachable, f'at 320 × 256 the end of the {tab} panel cannot be scrolled into view'
        zoomed.click('#add-more-phone')
        last_item = zoomed.locator('#add-menu-phone [data-add-shape=triangle]')
        last_item.scroll_into_view_if_needed()
        box = last_item.bounding_box()
        assert box and box['y'] >= 0 and box['y'] + box['height'] <= 256, f'at 320 × 256 the last shape in the menu is cut off: {box}'
        zoomed.keyboard.press('Escape')
        zoomed.screenshot(path=str(HERE / 'zoom-400.png'), full_page=True)
        zoomed.close()

        shaped = browser.new_page(viewport={'width': 1280, 'height': 900})
        shaped.on('console', lambda m: m.type == 'error' and errors.append(m.text))
        shaped.on('pageerror', lambda e: errors.append(str(e)))
        shaped.goto(URL)
        expect(shaped.locator('#parts li')).to_have_count(7)
        active = lambda: shaped.evaluate('[document.activeElement.name, document.activeElement.value || document.activeElement.id]')
        shape_of = lambda n: shaped.evaluate(f'woodworkingPlanner.project.parts[{n}].shape')

        shaped.locator('#parts li').nth(4).locator('.row-main').click()
        expect(shaped.locator('#editor input[name=shape][value=board]')).to_be_checked()
        shaped.focus('#editor input[name=shape][value=board]')
        shaped.keyboard.press('ArrowRight')
        assert shape_of(4) == 'disc', shape_of(4)
        assert active() == ['shape', 'disc'], f'switching shape with an arrow key lost focus: {active()}'
        ring = shaped.evaluate('getComputedStyle(document.activeElement.closest(".choice")).outlineStyle')
        assert ring == 'solid', f'the focused shape has no visible focus ring: {ring}'
        expect(shaped.locator('#editor [name=diameter]')).to_be_visible()
        expect(shaped.locator('#editor [name=length]')).to_be_hidden()
        expect(shaped.locator('#corners-box')).to_be_hidden()
        expect(shaped.locator('#cut-from')).to_have_text('Cut from 400 × 400 × 18')
        shaped.keyboard.press('ArrowLeft')
        assert shape_of(4) == 'board' and active() == ['shape', 'board'], active()
        expect(shaped.locator('#editor [name=length]')).to_have_value('764')
        assert shaped.evaluate('[...document.querySelectorAll("#sizes .field:not([hidden])")].map((f) => f.dataset.field).join()') == 'length,width,thickness'
        shaped.wait_for_timeout(1300)
        shaped.keyboard.press('ArrowRight')
        shaped.keyboard.press('Control+z')
        assert shape_of(4) == 'board' and active() == ['shape', 'board'], f'Ctrl+Z on a shape radio: {shape_of(4)} {active()}'

        shaped.click('#add-more')
        expect(shaped.locator('#add-more')).to_have_attribute('aria-expanded', 'true')
        assert active()[1] == '' and shaped.evaluate('document.activeElement.dataset.addShape') == 'disc', 'the menu did not focus its first item'
        shaped.keyboard.press('ArrowUp')
        assert shaped.evaluate('document.activeElement.dataset.addShape') == 'triangle', 'ArrowUp should wrap to the last item'
        shaped.keyboard.press('Escape')
        expect(shaped.locator('#add-menu')).to_be_hidden()
        assert active()[1] == 'add-more', f'Escape did not return focus to the menu button: {active()}'
        expect(shaped.locator('#editor')).to_be_visible()
        shaped.keyboard.press('ArrowDown')
        expect(shaped.locator('#add-menu')).to_be_visible()
        shaped.keyboard.press('Enter')
        expect(shaped.locator('#parts li')).to_have_count(8)
        assert active()[1] == 'add-more', f'adding from the menu lost focus: {active()}'
        expect(shaped.locator('.row.sel .nm')).to_have_text('Disc')
        expect(shaped.locator('.row.sel .dim')).to_have_text('⌀400 × 18')
        expect(shaped.locator('.row.sel svg.sil')).to_have_attribute('aria-hidden', 'true')
        expect(shaped.locator('#cut-rows')).to_contain_text('400 × 400 × 18')
        expect(shaped.locator('#cut-rows .shape-note')).to_have_text(['Disc ⌀400'])
        expect(shaped.locator('#totals')).to_contain_text('8 pieces')
        expect(shaped.locator('#viewport canvas')).to_have_attribute('aria-label', re.compile(r'8 pieces \(7 boards, 1 disc\)'))
        disc = shaped.evaluate('woodworkingPlanner.project.parts.at(-1)')
        assert disc['x'] >= 850 and disc['shape'] == 'disc', disc

        shaped.click('#add')
        expect(shaped.locator('#parts li')).to_have_count(9)
        expect(shaped.locator('#corner-pick')).to_be_hidden()
        shaped.click('#corners-box .choice:has-text("Rounded")')
        expect(shaped.locator('#corner-pick')).to_be_visible()
        expect(shaped.get_by_label('Bottom left')).to_be_checked()
        shaped.get_by_label('Bottom left').uncheck()
        shaped.get_by_label('Bottom right').uncheck()
        assert active() == ['cornerBottomRight', 'on'], f'ticking a corner lost focus: {active()}'
        expect(shaped.locator('.row.sel .dim')).to_have_text('600 × 200 × 18 · R20 ×2')
        expect(shaped.locator('#cut-rows')).to_contain_text('R20 ×2 corners (same side)')
        expect(shaped.locator('#cut-rows')).to_contain_text('600 × 200 × 18')
        shaped.fill('#editor [name=cornerRadius]', '150')
        expect(shaped.locator('#cornerRadius-error')).to_have_text('Enter a radius above 0, up to 100 mm (half the width).')
        expect(shaped.locator('#editor [name=cornerRadius]')).to_have_attribute('aria-describedby', 'cornerRadius-error')
        shaped.fill('#editor [name=cornerRadius]', '30')
        expect(shaped.locator('#cornerRadius-error')).to_be_hidden()
        shaped.fill('#editor [name=width]', '40')
        expect(shaped.locator('#width-error')).to_contain_text('at least 60 mm')
        shaped.fill('#editor [name=width]', '200')
        shaped.click('#corners-box .choice:has-text("Cut")')
        expect(shaped.locator('#editor [name=cutLength]')).to_be_visible()
        expect(shaped.locator('.row.sel .dim')).to_have_text('600 × 200 × 18 · cut 50 × 50 ×2')
        shaped.click('#corners-box .choice:has-text("Rounded")')
        shaped.wait_for_timeout(1300)

        shaped.click('#lock')
        for name in ['shape', 'corners', 'cornerTopLeft', 'cornerRadius']:
            expect(shaped.locator(f'#editor [name={name}]').first).to_be_disabled()
        shaped.click('#lock')

        shaped.click('.shape-pick .choice:has-text("Arc")')
        expect(shaped.locator('#arc-inner')).to_contain_text('Inner radius 340 mm')
        shaped.fill('#editor [name=bandWidth]', '500')
        expect(shaped.locator('#bandWidth-error')).to_contain_text('less than the outer radius')
        shaped.fill('#editor [name=sweep]', '400')
        expect(shaped.locator('#sweep-error')).to_contain_text('1° to 360°')
        shaped.click('#undo')
        expect(shaped.locator('#editor input[name=shape][value=board]')).to_be_checked()
        expect(shaped.locator('.row.sel .dim')).to_have_text('600 × 200 × 18 · R30 ×2')

        shaped.reload()
        expect(shaped.locator('#parts li')).to_have_count(9)
        expect(shaped.locator('#parts li').last.locator('.dim')).to_have_text('600 × 200 × 18 · R30 ×2')
        shaped.wait_for_timeout(500)
        shaped.screenshot(path=str(HERE / 'shapes-1280.png'))

        shaped.click('#add-more')
        shaped.click('#add-menu [data-add-shape=triangle]')
        expect(shaped.locator('.row.sel .nm')).to_have_text('Triangle')
        triangle_pose = lambda: shaped.evaluate('woodworkingPlanner.project.parts.at(-1).pose')
        start_pose = triangle_pose()
        canvas = shaped.locator('#viewport canvas')
        shaped.wait_for_timeout(400)
        before = canvas.screenshot()
        shaped.click('[data-rotate=z]')
        shaped.click('[data-rotate=z]')
        assert triangle_pose() != start_pose, f'two Rolls left the triangle as it was: {triangle_pose()}'
        triangle_y = shaped.evaluate('woodworkingPlanner.project.parts.at(-1).y')
        assert triangle_y == 0, f'two Rolls lifted the triangle off the floor to y {triangle_y}'
        expect(shaped.locator('#editor [name=pose] option:checked')).to_have_text('Lying flat, length left–right, flipped end over end')
        shaped.wait_for_timeout(400)
        assert canvas.screenshot() != before, 'two Rolls did not change how the triangle is drawn'
        shaped.click('[data-rotate=z]')
        shaped.click('[data-rotate=z]')
        assert triangle_pose() == start_pose, f'four Rolls should bring the triangle back: {triangle_pose()}'

        shaped.click('#add-more')
        shaped.click('#add-menu [data-add-shape=arc]')
        for name, value in [('outerRadius', '1234.5'), ('bandWidth', '234.5'), ('sweep', '123.5'), ('thickness', '45.5')]:
            shaped.fill(f'#editor [name={name}]', value)
        expect(shaped.locator('.row.sel .dim')).to_have_text('Arc R1,234.5 × 234.5 × 123.5° × 45.5')
        for target in ['.row.sel .dim', '#view-sel']:
            fits = shaped.evaluate(f'(() => {{ const e = document.querySelector("{target}"); return e.scrollWidth <= e.clientWidth && e.getBoundingClientRect().right <= e.parentElement.getBoundingClientRect().right; }})()')
            assert fits, f'{target} cuts off a long size'
        shaped.add_style_tag(content='* { letter-spacing: 0.12em !important; word-spacing: 0.16em !important; line-height: 1.5 !important; }')
        clipped = shaped.evaluate('[...document.querySelectorAll(".shape-pick .choice")].filter((c) => c.lastElementChild.getBoundingClientRect().right > c.getBoundingClientRect().right + 0.5).map((c) => c.textContent)')
        assert not clipped, f'with WCAG text spacing these shape names overflow their cell: {clipped}'
        shaped.evaluate('localStorage.clear()')
        shaped.close()

        dark = browser.new_page(viewport={'width': 1280, 'height': 900}, color_scheme='dark')
        dark.goto(URL)
        dark.wait_for_timeout(600)
        panel = dark.evaluate('getComputedStyle(document.querySelector(".bar")).backgroundColor')
        dark.locator('#parts li').first.locator('.row-main').click()
        for field in ['#project-name', '#editor .shapes', '#editor [name=length]']:
            edge = dark.evaluate(f'getComputedStyle(document.querySelector("{field}")).borderTopColor')
            assert contrast(edge, panel) >= 3, f'dark {field} border {edge} is {contrast(edge, panel):.2f}:1'
        dark.screenshot(path=str(HERE / 'dark-1280.png'))
        browser.close()
finally:
    server.terminate()

if errors:
    print('Console errors:', *errors, sep='\n  ')
    sys.exit(1)
print('UI test passed')
