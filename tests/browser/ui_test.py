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
        expect(page.locator('#editor [name=orientation]')).to_be_disabled()
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
        shelf = lambda: page.evaluate('(() => { const p = woodworkingPlanner.project.parts[4]; return [p.orientation, p.y] })()')
        page.click('[data-rotate=y]')
        assert shelf()[0] == 'zxy', shelf()
        expect(page.locator('#editor [name=orientation]')).to_have_value('zxy')
        page.keyboard.press('r')
        assert shelf()[0] == 'xzy', shelf()
        page.click('[data-rotate=x]')
        assert shelf()[0] == 'xyz', shelf()
        page.wait_for_timeout(300)
        page.screenshot(path=str(HERE / 'tipped-1280.png'))
        page.keyboard.press('Control+z')
        assert shelf()[0] == 'xzy', f'one undo should take back only the Tip: {shelf()}'
        page.keyboard.press('Control+z')
        assert shelf()[0] == 'zxy', f'each rotation is its own undo step: {shelf()}'

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

        dark = browser.new_page(viewport={'width': 1280, 'height': 900}, color_scheme='dark')
        dark.goto(URL)
        dark.wait_for_timeout(600)
        dark.screenshot(path=str(HERE / 'dark-1280.png'))
        browser.close()
finally:
    server.terminate()

if errors:
    print('Console errors:', *errors, sep='\n  ')
    sys.exit(1)
print('UI test passed')
