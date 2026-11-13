import { SPECIES, cutList, roundMm } from './model.js';
import { KERF_LIMITS, STOCK_LIMITS, STOCK_PRESETS, TRIM_LIMITS, cuttingOf, cuttingPlan, planPieces } from './cutplan.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const OWN = 'own';
const MARGIN_PX = 1;
const FULL_LABEL = { width: 96, height: 30 };
const NUMBER_LABEL = { width: 18, height: 16 };
const CHIP_PAD_PX = 4;
const LINE_PX = 13;

const WORDS = {
  sheet: { one: 'sheet', many: 'sheets' },
  board: { one: 'board', many: 'boards' },
};
const counted = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const stockWord = (kind, count) => (count === 1 ? WORDS[kind].one : WORDS[kind].many);
const capital = (text) => text[0].toUpperCase() + text.slice(1);
const percent = (share) => `${Math.round(share * 100)}%`;
const presetValue = (size) => `${size.length}x${size.width}`;

function svgNode(tag, attributes = {}, className) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (className) node.setAttribute('class', className);
  return node;
}

export function createPlanView({ root, mm, element, visible, getProject, onPick, onChange }) {
  const $ = (id) => root.querySelector(`#${id}`);
  const nodes = {
    empty: $('plan-empty'),
    totals: $('plan-totals'),
    groups: $('plan-groups'),
    rods: $('plan-rods'),
    kerf: $('kerf'),
    trim: $('trim'),
  };
  const sections = new Map();
  const drawings = new Map();
  let cached = { parts: null, cutting: null, plan: null };
  let selected = null;
  const size = (length, width) => `${mm(length)} × ${mm(width)}`;

  const measure = (() => {
    const context = document.createElement('canvas').getContext('2d');
    const fonts = {};
    return (text, mono = false) => {
      const family = mono ? 'mono' : 'sans';
      fonts[family] ??= getComputedStyle(document.documentElement).getPropertyValue(`--${family}`).trim() || family;
      context.font = `11px ${fonts[family]}`;
      return context.measureText(text).width;
    };
  })();

  function planOf(project) {
    const cutting = cuttingOf(project);
    if (cached.parts !== project.parts || cached.cutting !== cutting) {
      cached = { parts: project.parts, cutting, plan: cuttingPlan(planPieces(cutList(project.parts)), cutting) };
    }
    return cached.plan;
  }

  function showError(input, message) {
    const note = root.querySelector(`[id="${input.id}-error"]`);
    if (note.textContent !== (message ?? '')) note.textContent = message ?? '';
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', note.id);
    } else {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
  }

  function readMm(input, limits) {
    const value = Number(input.value);
    return input.value !== '' && Number.isFinite(value) && value >= limits.min && value <= limits.max ? roundMm(value) : null;
  }

  function sawField(input, field, limits, word) {
    input.addEventListener('input', () => {
      const value = readMm(input, limits);
      if (value === null) {
        showError(input, `Enter a ${word} from ${mm(limits.min)} to ${mm(limits.max)}.`);
        return;
      }
      showError(input, null);
      const cutting = cuttingOf(getProject());
      if (cutting[field] !== value) onChange({ ...cutting, [field]: value }, field);
    });
  }
  sawField(nodes.kerf, 'kerf', KERF_LIMITS, 'kerf');
  sawField(nodes.trim, 'trim', TRIM_LIMITS, 'trim');

  function setStock(key, stock, mergeKey = null) {
    const cutting = cuttingOf(getProject());
    onChange({ ...cutting, stock: { ...cutting.stock, [key]: stock } }, mergeKey);
  }

  function ownField(key, side, label) {
    const wrap = element('div', 'field');
    const input = element('input', 'num');
    Object.assign(input, { id: `own-${side}-${key}`, type: 'number', min: String(STOCK_LIMITS.min), max: String(STOCK_LIMITS.max), step: 'any', inputMode: 'decimal' });
    input.dataset.length = '';
    input.dataset.side = side;
    const text = element('label', '', `${label} `);
    text.append(input);
    const note = Object.assign(element('p', 'field-error'), { id: `own-${side}-${key}-error` });
    note.setAttribute('aria-live', 'polite');
    wrap.append(text, note);
    input.addEventListener('input', () => {
      const value = readMm(input, STOCK_LIMITS);
      if (value === null) {
        showError(input, `Enter a ${side} from ${mm(STOCK_LIMITS.min)} to ${mm(STOCK_LIMITS.max)}.`);
        return;
      }
      showError(input, null);
      const current = cachedGroup(key)?.stock;
      if (current) setStock(key, { length: current.length, width: current.width, [side]: value, own: true }, `own-${side}-${key}`);
    });
    return wrap;
  }

  const cachedGroup = (key) => cached.plan?.groups.find((group) => group.key === key);

  function stockSelect(key, kind) {
    const select = document.createElement('select');
    for (const preset of STOCK_PRESETS[kind]) {
      const group = Object.assign(document.createElement('optgroup'), { label: preset.label });
      group.append(...preset.sizes.map((each) => new Option(size(each.length, each.width), presetValue(each))));
      select.append(group);
    }
    select.append(new Option('Own size…', OWN));
    select.addEventListener('change', () => {
      const current = cachedGroup(key)?.stock;
      if (!current) return;
      if (select.value === OWN) {
        setStock(key, { length: current.length, width: current.width, own: true });
        return;
      }
      const [length, width] = select.value.split('x').map(Number);
      setStock(key, { length, width, own: false });
    });
    return select;
  }

  function section(group) {
    if (sections.has(group.key)) return sections.get(group.key);
    const node = element('section', 'stock-group');
    node.dataset.group = group.key;
    const heading = element('h3', 'stock-h');
    heading.append(element('span', 'jn'), ' ', element('span', 'dim'));
    const select = stockSelect(group.key, group.kind);
    const pick = element('label', 'stock-pick', 'Stock size (mm) ');
    pick.append(select);
    const own = element('div', 'duo own');
    own.append(ownField(group.key, 'length', 'Length (mm)'), ownField(group.key, 'width', 'Width (mm)'));
    const warnings = element('div', 'stock-warnings');
    const diagrams = element('div', 'stock-diagrams');
    node.append(heading, pick, own, warnings, diagrams);
    const controls = { node, heading, select, own, warnings, diagrams };
    sections.set(group.key, controls);
    return controls;
  }

  function misfitText(misfit, group) {
    const word = stockWord(group.kind, 1);
    const stock = size(group.stock.length, group.stock.width);
    const piece = `${misfit.name} (${size(misfit.length, misfit.width)})`;
    if (misfit.reason === 'grain') {
      return `${piece} is too wide for the ${stock} ${word} with its grain along the length. Untick Keep the grain along the length for it, or pick a bigger stock size.`;
    }
    return `${piece} is bigger than the ${stock} ${word}. Pick a bigger stock size or make the piece smaller.`;
  }

  function fillSection(controls, group) {
    const [name, summary] = controls.heading.querySelectorAll('span');
    name.textContent = `${SPECIES[group.species].label} · ${mm(group.thickness)} mm`;
    const count = group.sheets.length;
    const waste = count ? ` · ${percent(group.waste)} waste` : '';
    summary.textContent = `Buy ${count} ${stockWord(group.kind, count)} · ${size(group.stock.length, group.stock.width)}${waste}`;
    const preset = STOCK_PRESETS[group.kind].some((each) => each.sizes.some((one) => presetValue(one) === presetValue(group.stock)));
    controls.select.value = group.stock.own || !preset ? OWN : presetValue(group.stock);
    controls.own.hidden = controls.select.value !== OWN;
    for (const input of controls.own.querySelectorAll('input')) {
      if (input === document.activeElement) continue;
      input.value = String(group.stock[input.dataset.side]);
      showError(input, null);
    }
    controls.warnings.replaceChildren(
      ...group.misfits.map((misfit) => Object.assign(element('p', 'warn', misfitText(misfit, group)), { role: 'status' })),
    );
    const focused = controls.diagrams.contains(document.activeElement) ? document.activeElement.dataset.pick : null;
    controls.diagrams.replaceChildren(...group.runs.map((run) => figure(run, group)));
    if (focused) controls.diagrams.querySelector(`[data-pick="${focused}"]`)?.focus();
  }

  function caption(run, group) {
    const total = group.sheets.length;
    const where = size(group.stock.length, group.stock.width);
    const pieces = run.sheet.placements.length;
    const waste = `${percent(run.sheet.waste)} waste`;
    if (run.first === run.last) {
      return `${capital(stockWord(group.kind, 1))} ${run.first} of ${total} · ${where} · ${counted(pieces, 'piece', 'pieces')} · ${waste}`;
    }
    const copies = run.last - run.first + 1;
    return `${capital(stockWord(group.kind, 2))} ${run.first}–${run.last} of ${total} · same layout, ${copies} × · ${counted(pieces, 'piece', 'pieces')} each · ${waste}`;
  }

  function figure(run, group) {
    const node = element('figure', 'stock-sheet');
    const svg = svgNode('svg', { 'aria-hidden': 'true', focusable: 'false' });
    svg.addEventListener('click', (event) => {
      const id = event.target.closest('[data-id]')?.dataset.id;
      if (id) onPick(id);
    });
    const copies = group.sheets.slice(run.first - 1, run.last);
    const key = element('ol', 'stock-key');
    for (const [copy, sheet] of copies.entries()) {
      for (const placement of sheet.placements) {
        const item = element('li');
        const button = element('button', '', `${placement.number} ${placement.name} ${size(placement.length, placement.width)}`);
        button.type = 'button';
        button.dataset.pick = placement.id;
        button.setAttribute('aria-pressed', String(placement.id === selected));
        if (copies.length > 1) button.setAttribute('aria-label', `${button.textContent}, ${stockWord(group.kind, 1)} ${run.first + copy}`);
        button.addEventListener('click', () => onPick(placement.id));
        item.append(button);
        key.append(item);
      }
    }
    const picked = copies.flatMap((sheet) => sheet.placements).find((placement) => placement.id === selected)?.number ?? null;
    node.append(svg, element('figcaption', 'dim', caption(run, group)), key);
    drawings.set(svg, { sheet: run.sheet, group, picked });
    return node;
  }

  const overlapping = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  function chip(x, y, lines, box, keepClear) {
    const label = svgNode('g', {}, 'piece-label');
    const width = Math.max(...lines.map((line) => line.width)) + 2 * CHIP_PAD_PX;
    const height = lines.length * LINE_PX + 2;
    if (keepClear && overlapping({ x: x - width / 2, y: y - height / 2, width, height }, keepClear)) {
      x = keepClear.x + keepClear.width + 4 + width / 2;
      if (x + width / 2 > box.x + box.width - 2) return null;
    }
    label.append(svgNode('rect', { x: x - width / 2, y: y - height / 2, width, height, rx: 4 }, 'chip'));
    lines.forEach((line, i) => {
      const text = svgNode('text', { x: x - width / 2 + CHIP_PAD_PX, y: y - height / 2 + 1 + LINE_PX * (i + 1) - 3 }, line.mono ? 'mono' : '');
      text.textContent = line.text;
      label.append(text);
    });
    return label;
  }

  function clipped(text, room) {
    if (measure(text) <= room) return text;
    let kept = text;
    while (kept.length > 1 && measure(`${kept}…`) > room) kept = kept.slice(0, -1);
    return `${kept.trimEnd()}…`;
  }

  function pieceLabel(placement, box, keepClear) {
    const centre = [box.x + box.width / 2, box.y + box.height / 2];
    const room = box.width - 2 * CHIP_PAD_PX - 4;
    if (box.width >= FULL_LABEL.width && box.height >= FULL_LABEL.height) {
      const title = clipped(`${placement.number} ${placement.name}`, room);
      const dims = size(placement.length, placement.width);
      return chip(...centre, [
        { text: title, width: measure(title) },
        { text: dims, width: Math.min(measure(dims, true), room), mono: true },
      ], box, keepClear);
    }
    if (box.width >= NUMBER_LABEL.width && box.height >= NUMBER_LABEL.height) {
      const number = String(placement.number);
      return chip(...centre, [{ text: number, width: measure(number) }], box, keepClear);
    }
    return null;
  }

  function draw(svg, { sheet, group, picked }) {
    const available = Math.floor(svg.parentElement.clientWidth);
    if (!available) return;
    const { kerf, trim } = cuttingOf(getProject());
    const scale = (available - 2 * MARGIN_PX) / group.stock.length;
    const height = group.stock.width * scale + 2 * MARGIN_PX;
    const at = (mmValue) => MARGIN_PX + mmValue * scale;
    Object.entries({ width: available, height: height.toFixed(1), viewBox: `0 0 ${available} ${height.toFixed(1)}` }).forEach(([name, value]) =>
      svg.setAttribute(name, value),
    );
    const outline = { x: MARGIN_PX, y: MARGIN_PX, width: group.stock.length * scale, height: group.stock.width * scale };
    const layers = [svgNode('rect', outline, trim > 0 ? 'trim' : 'stock')];
    if (trim > 0) {
      layers.push(svgNode('rect', { x: at(trim), y: at(trim), width: (group.stock.length - 2 * trim) * scale, height: (group.stock.width - 2 * trim) * scale }, 'usable'));
    }
    const inset = kerf > 0 ? Math.max(0, (2 - kerf * scale) / 2) : 0;
    const boxes = sheet.placements.map((placement) => ({
      placement,
      box: {
        x: at(placement.x) + inset,
        y: at(placement.y) + inset,
        width: Math.max(0.5, placement.length * scale - 2 * inset),
        height: Math.max(0.5, placement.width * scale - 2 * inset),
      },
    }));
    const ordered = [...boxes].sort((a, b) => (a.placement.number === picked) - (b.placement.number === picked));
    for (const { placement, box } of ordered) {
      const rect = svgNode('rect', { ...box, fill: SPECIES[group.species].color, 'data-id': placement.id }, placement.number === picked ? 'piece sel' : 'piece');
      layers.push(rect);
    }
    for (const offcut of sheet.offcuts) {
      const box = { x: at(offcut.x), y: at(offcut.y), width: offcut.length * scale, height: offcut.width * scale };
      layers.push(svgNode('rect', box, 'offcut'));
      const text = size(offcut.length, offcut.width);
      if (measure(text, true) + 2 * CHIP_PAD_PX <= box.width && LINE_PX + 4 <= box.height) {
        const label = svgNode('text', { x: box.x + box.width / 2, y: box.y + box.height / 2 + 4, 'text-anchor': 'middle' }, 'mono muted note');
        label.textContent = text;
        layers.push(label);
      }
    }
    let grainBox = null;
    if (SPECIES[group.species].grain && outline.height >= LINE_PX + 6) {
      const text = '→ grain';
      grainBox = { x: outline.x + 3, y: outline.y + outline.height - LINE_PX - 4, width: measure(text) + 2 * CHIP_PAD_PX, height: LINE_PX + 2 };
      const grain = svgNode('g', {}, 'note');
      grain.append(svgNode('rect', { ...grainBox, rx: 4 }, 'chip'));
      const label = svgNode('text', { x: grainBox.x + CHIP_PAD_PX, y: grainBox.y + LINE_PX - 2 }, 'muted');
      label.textContent = text;
      grain.append(label);
      layers.push(grain);
    }
    for (const { placement, box } of boxes) {
      const label = pieceLabel(placement, box, grainBox);
      if (label) layers.push(label);
    }
    layers.push(svgNode('rect', outline, 'edge'));
    svg.replaceChildren(...layers);
  }

  function redraw() {
    for (const [svg, data] of drawings) {
      if (svg.isConnected) draw(svg, data);
      else drawings.delete(svg);
    }
  }

  let lastWidth = 0;
  new ResizeObserver(() => {
    if (root.clientWidth === lastWidth) return;
    lastWidth = root.clientWidth;
    redraw();
  }).observe(root);

  function totals(plan) {
    const stat = (value, label, className) => {
      const span = element('span', className);
      span.append(element('b', '', value), ` ${label}`);
      return span;
    };
    const kinds = ['sheet', 'board'].filter((kind) => plan.groups.some((group) => group.kind === kind));
    const buy = element('span');
    buy.append('Buy ');
    kinds.forEach((kind, i) => {
      if (i) buy.append(' and ');
      const count = kind === 'sheet' ? plan.sheets : plan.boards;
      buy.append(element('b', '', String(count)), ` ${stockWord(kind, count)}`);
    });
    const items = [buy];
    if (plan.sheets + plan.boards) items.push(stat(percent(plan.waste), 'waste'));
    if (plan.misfits) items.push(stat(String(plan.misfits), plan.misfits === 1 ? 'piece doesn’t fit' : 'pieces don’t fit', 'misfit'));
    nodes.totals.replaceChildren(...items);
    nodes.totals.hidden = kinds.length === 0;
  }

  function rods(project) {
    const rows = cutList(project.parts).filter((row) => row.shape === 'dowel');
    nodes.rods.hidden = rows.length === 0;
    nodes.rods.textContent = rows.length
      ? `Dowels are bought as rod and are not laid out: ${rows.map((row) => `${row.count} × ⌀${mm(row.width)} × ${mm(row.length)}`).join(', ')}.`
      : '';
  }

  function render(project, selectedId) {
    if (!visible(root)) return;
    selected = selectedId;
    const cutting = cuttingOf(project);
    for (const [input, field] of [[nodes.kerf, 'kerf'], [nodes.trim, 'trim']]) {
      if (input === document.activeElement && input.getAttribute('aria-invalid') === 'true') continue;
      if (input === document.activeElement && Number(input.value) === cutting[field]) continue;
      input.value = String(cutting[field]);
      showError(input, null);
    }
    const empty = project.parts.length === 0;
    nodes.empty.hidden = !empty;
    const plan = planOf(project);
    totals(plan);
    if (empty) nodes.totals.hidden = true;
    rods(project);
    const keys = new Set(plan.groups.map((group) => group.key));
    for (const [key, each] of sections) {
      if (!keys.has(key)) {
        each.node.remove();
        sections.delete(key);
      }
    }
    drawings.clear();
    plan.groups.forEach((group, i) => {
      const each = section(group);
      if (nodes.groups.children[i] !== each.node) nodes.groups.insertBefore(each.node, nodes.groups.children[i] ?? null);
      fillSection(each, group);
    });
    redraw();
  }

  return { render };
}
