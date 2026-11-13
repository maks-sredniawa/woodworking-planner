import { SPECIES, cutList, roundMm } from './model.js';

export const KERF_LIMITS = { min: 0, max: 10 };
export const TRIM_LIMITS = { min: 0, max: 100 };
export const STOCK_LIMITS = { min: 100, max: 10000 };
export const KEEP_OFFCUT_MM = 100;
export const DEFAULT_CUTTING = { kerf: 3, trim: 0, stock: {} };

const sizes = (list) => list.map(([length, width]) => ({ length, width }));

export const STOCK_PRESETS = {
  sheet: [{ label: 'Sheets', sizes: sizes([[2440, 1220], [2500, 1250], [1525, 1525], [1220, 610], [2800, 2070]]) }],
  board: [
    { label: 'Boards', sizes: sizes([[2400, 94], [2400, 144], [2400, 194], [2400, 244], [3000, 194], [3000, 244]]) },
    { label: 'Glued panels', sizes: sizes([[2000, 400], [2000, 600]]) },
  ],
};

const FALLBACK_STOCK = { sheet: { length: 2440, width: 1220 }, board: { length: 2400, width: 244 } };
const EPSILON = 1e-6;

export const stockKind = (species) => SPECIES[species].stock;
export const groupKey = (piece) => `${piece.species}:${piece.thickness}`;

export function planPieces(rows) {
  return rows
    .filter((row) => row.shape !== 'dowel')
    .flatMap((row) =>
      row.parts.map((part) => ({
        id: part.id,
        name: part.name || 'Unnamed',
        species: row.species,
        length: row.length,
        width: row.width,
        thickness: row.thickness,
        grain: part.grain ?? SPECIES[row.species].grain,
      })),
    );
}

const usable = (stock, trim) => ({ length: stock.length - 2 * trim, width: stock.width - 2 * trim });
const fitsAs = (length, width, room) => length <= room.length + EPSILON && width <= room.width + EPSILON;

function fit(piece, stock, trim) {
  const room = usable(stock, trim);
  if (fitsAs(piece.length, piece.width, room)) return null;
  const turnedFits = fitsAs(piece.width, piece.length, room);
  if (turnedFits && !piece.grain) return null;
  return turnedFits ? 'grain' : 'big';
}

const presetsOf = (kind) => STOCK_PRESETS[kind].flatMap((group) => group.sizes);

export function defaultStock(kind, pieces, trim = 0) {
  if (kind === 'sheet') return FALLBACK_STOCK.sheet;
  const fitting = presetsOf(kind).filter((stock) => pieces.every((piece) => !fit(piece, stock, trim)));
  const smallest = fitting.reduce((best, stock) => (!best || stock.length * stock.width < best.length * best.width ? stock : best), null);
  return smallest ?? FALLBACK_STOCK[kind];
}

function stockFor(key, kind, pieces, settings) {
  const chosen = settings.stock?.[key];
  if (chosen) return { length: chosen.length, width: chosen.width, own: Boolean(chosen.own), chosen: true };
  return { ...defaultStock(kind, pieces, settings.trim), own: false, chosen: false };
}

export function stockGroups(pieces, settings = DEFAULT_CUTTING) {
  const byKey = new Map();
  for (const piece of pieces) {
    const key = groupKey(piece);
    if (!byKey.has(key)) byKey.set(key, { key, species: piece.species, kind: stockKind(piece.species), thickness: piece.thickness, pieces: [] });
    byKey.get(key).pieces.push(piece);
  }
  const kindOrder = { sheet: 0, board: 1 };
  return [...byKey.values()]
    .map((group) => ({ ...group, stock: stockFor(group.key, group.kind, group.pieces, settings) }))
    .sort(
      (a, b) =>
        kindOrder[a.kind] - kindOrder[b.kind] ||
        SPECIES[a.species].label.localeCompare(SPECIES[b.species].label) ||
        a.thickness - b.thickness,
    );
}

export function misfitIds(pieces, settings = DEFAULT_CUTTING) {
  return new Set(
    stockGroups(pieces, settings).flatMap((group) => group.pieces.filter((piece) => fit(piece, group.stock, settings.trim)).map((piece) => piece.id)),
  );
}

const ORDERS = [
  (a, b) => b.length * b.width - a.length * a.width,
  (a, b) => Math.max(b.length, b.width) - Math.max(a.length, a.width) || b.length * b.width - a.length * a.width,
  (a, b) => b.width - a.width || b.length - a.length,
];

const SPLITS = [
  (rect, w, h) => rect.w - w < rect.h - h,
  (rect, w, h) => rect.w - w >= rect.h - h,
  (rect, w, h) => (rect.w - w) * rect.h < rect.w * (rect.h - h),
];

function splitRect(rect, w, h, kerf, alongLength) {
  const right = { x: roundMm(rect.x + w + kerf), y: rect.y, w: roundMm(rect.w - w - kerf), h: alongLength ? h : rect.h };
  const below = { x: rect.x, y: roundMm(rect.y + h + kerf), w: alongLength ? rect.w : w, h: roundMm(rect.h - h - kerf) };
  return [right, below].filter((part) => part.w > EPSILON && part.h > EPSILON);
}

function bestSpot(sheets, piece) {
  let best = null;
  const turns = piece.grain || piece.length === piece.width ? [false] : [false, true];
  sheets.forEach((sheet, s) =>
    sheet.free.forEach((rect, r) => {
      for (const turned of turns) {
        const w = turned ? piece.width : piece.length;
        const h = turned ? piece.length : piece.width;
        if (w > rect.w + EPSILON || h > rect.h + EPSILON) continue;
        const spare = rect.w * rect.h - w * h;
        const side = Math.min(rect.w - w, rect.h - h);
        if (!best || spare < best.spare - EPSILON || (Math.abs(spare - best.spare) <= EPSILON && side < best.side - EPSILON)) {
          best = { s, r, w, h, turned, spare, side };
        }
      }
    }),
  );
  return best;
}

function pack(pieces, stock, { kerf, trim }, order, split) {
  const room = usable(stock, trim);
  const fresh = () => ({ placements: [], free: [{ x: trim, y: trim, w: room.length, h: room.width }] });
  const sheets = [];
  for (const piece of [...pieces].sort((a, b) => order(a, b) || a.index - b.index)) {
    let spot = bestSpot(sheets, piece);
    if (!spot) {
      sheets.push(fresh());
      spot = bestSpot(sheets.slice(-1), piece);
      spot.s = sheets.length - 1;
    }
    const sheet = sheets[spot.s];
    const rect = sheet.free[spot.r];
    sheet.placements.push({ id: piece.id, name: piece.name, x: rect.x, y: rect.y, length: spot.w, width: spot.h, turned: spot.turned });
    sheet.free.splice(spot.r, 1, ...splitRect(rect, spot.w, spot.h, kerf, split(rect, spot.w, spot.h)));
  }
  return sheets;
}

const spreadOut = (sheets) => sheets.reduce((sum, sheet) => sum + sheet.free.reduce((each, rect) => each + (rect.w * rect.h) ** 2, 0), 0);

function bestPacking(pieces, stock, settings) {
  let best = null;
  for (const order of ORDERS) {
    for (const split of SPLITS) {
      const sheets = pack(pieces, stock, settings, order, split);
      if (!best || sheets.length < best.length || (sheets.length === best.length && spreadOut(sheets) > spreadOut(best))) best = sheets;
    }
  }
  return best ?? [];
}

const area = (items) => items.reduce((sum, item) => sum + item.length * item.width, 0);
const wasteOf = (stockArea, used) => (stockArea > 0 ? (stockArea - used) / stockArea : 0);
const signature = (sheet) => sheet.placements.map((p) => [p.x, p.y, p.length, p.width, p.name].join(':')).join('|');

function finish(sheet, stock) {
  const placements = [...sheet.placements]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((placement, i) => ({ ...placement, number: i + 1 }));
  const offcuts = sheet.free
    .filter((rect) => rect.w >= KEEP_OFFCUT_MM && rect.h >= KEEP_OFFCUT_MM)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((rect) => ({ x: rect.x, y: rect.y, length: rect.w, width: rect.h }));
  return { placements, offcuts, waste: wasteOf(stock.length * stock.width, area(placements)) };
}

function runsOf(sheets) {
  const runs = [];
  sheets.forEach((sheet, i) => {
    const last = runs.at(-1);
    if (last && signature(last.sheet) === signature(sheet)) last.last = i + 1;
    else runs.push({ first: i + 1, last: i + 1, sheet });
  });
  return runs;
}

function planGroup(group, settings) {
  const misfits = [];
  const fitting = [];
  group.pieces.forEach((piece, index) => {
    const reason = fit(piece, group.stock, settings.trim);
    if (reason) misfits.push({ id: piece.id, name: piece.name, length: piece.length, width: piece.width, reason });
    else fitting.push({ ...piece, index });
  });
  const sheets = bestPacking(fitting, group.stock, settings)
    .map((sheet) => finish(sheet, group.stock))
    .sort((a, b) => a.waste - b.waste || signature(a).localeCompare(signature(b)));
  const stockArea = sheets.length * group.stock.length * group.stock.width;
  const used = area(sheets.flatMap((sheet) => sheet.placements));
  return {
    key: group.key,
    species: group.species,
    kind: group.kind,
    thickness: group.thickness,
    stock: group.stock,
    sheets,
    runs: runsOf(sheets),
    misfits,
    stockArea,
    used,
    waste: wasteOf(stockArea, used),
  };
}

export function cuttingPlan(pieces, settings = DEFAULT_CUTTING) {
  const groups = stockGroups(pieces, settings).map((group) => planGroup(group, settings));
  const count = (kind) => groups.filter((group) => group.kind === kind).reduce((sum, group) => sum + group.sheets.length, 0);
  const stockArea = groups.reduce((sum, group) => sum + group.stockArea, 0);
  const used = groups.reduce((sum, group) => sum + group.used, 0);
  return {
    groups,
    sheets: count('sheet'),
    boards: count('board'),
    misfits: groups.reduce((sum, group) => sum + group.misfits.length, 0),
    waste: wasteOf(stockArea, used),
  };
}

const within = (value, { min, max }) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

function stockFromFile(key, raw) {
  const [species, thickness] = key.split(':');
  const sound =
    Object.hasOwn(SPECIES, species) &&
    Number(thickness) > 0 &&
    within(raw?.length, STOCK_LIMITS) &&
    within(raw?.width, STOCK_LIMITS) &&
    (raw.own === undefined || typeof raw.own === 'boolean');
  if (!sound) throw new Error(`This project has an invalid stock size for ${key}.`);
  return { length: roundMm(raw.length), width: roundMm(raw.width), own: Boolean(raw.own) };
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

export function cuttingFromFile(raw) {
  if (raw === undefined) return { ...DEFAULT_CUTTING, stock: {} };
  if (!isRecord(raw) || (raw.stock !== undefined && !isRecord(raw.stock))) throw new Error('This project has invalid cutting settings.');
  const kerf = raw.kerf ?? DEFAULT_CUTTING.kerf;
  const trim = raw.trim ?? DEFAULT_CUTTING.trim;
  if (!within(kerf, KERF_LIMITS)) throw new Error('This project has an invalid saw kerf.');
  if (!within(trim, TRIM_LIMITS)) throw new Error('This project has an invalid edge trim.');
  const stock = Object.fromEntries(Object.entries(raw.stock ?? {}).map(([key, value]) => [key, stockFromFile(key, value)]));
  return { kerf: roundMm(kerf), trim: roundMm(trim), stock };
}

export const cuttingOf = (project) => project.cutting ?? DEFAULT_CUTTING;

export function cuttingToFile(project) {
  const cutting = cuttingOf(project);
  const used = new Set(planPieces(cutList(project.parts)).map(groupKey));
  return { ...cutting, stock: Object.fromEntries(Object.entries(cutting.stock).filter(([key]) => used.has(key))) };
}
