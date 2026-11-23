const INCH = 25.4;

export const UNITS = {
  mm: { id: 'mm', label: 'mm', name: 'mm', fine: 0.1, snap: 10, nudge: 10, fineNudge: 1, floor: 100, block: 10, gap: 50 },
  in16: { id: 'in16', label: 'in · 1/16', name: 'in', fine: INCH / 16, snap: INCH / 2, nudge: INCH / 2, fineNudge: INCH / 16, floor: 6 * INCH, block: 8, gap: 2 * INCH, den: 16 },
  in32: { id: 'in32', label: 'in · 1/32', name: 'in', fine: INCH / 32, snap: INCH / 2, nudge: INCH / 2, fineNudge: INCH / 32, floor: 6 * INCH, block: 8, gap: 2 * INCH, den: 32 },
};

let current = UNITS.mm;

export function setUnits(id) {
  current = Object.hasOwn(UNITS, id) ? UNITS[id] : UNITS.mm;
}

export const units = () => current;
export const unitName = () => current.name;
export const inInches = () => Boolean(current.den);

export const exactMm = (value) => Math.round(value * 1e5) / 1e5 + 0;

const roundAway = (value) => Math.sign(value) * Math.floor(Math.abs(value) + 0.5 + 1e-9);
const tenths = (value) => roundAway(exactMm(value * 10)) / 10 + 0;
const sixteenths = (value, den) => roundAway(exactMm((value / INCH) * den));

export const num = (value) => `${Number(value).toLocaleString('en-GB', { maximumFractionDigits: 1 })}`;

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

function fraction(value, den, gap) {
  const count = sixteenths(value, den);
  if (!count) return '0';
  const whole = Math.floor(Math.abs(count) / den);
  const rest = Math.abs(count) % den;
  const sign = count < 0 ? '-' : '';
  if (!rest) return `${sign}${whole}`;
  const common = gcd(rest, den);
  const part = `${rest / common}/${den / common}`;
  return whole ? `${sign}${whole}${gap}${part}` : `${sign}${part}`;
}

export const len = (value) => (current.den ? fraction(value, current.den, ' ') : num(value));
export const lenUnit = (value) => `${len(value)} ${current.name}`;

const shownMm = (value) => (current.den ? (sixteenths(value, current.den) / current.den) * INCH : tenths(value));
export const isRounded = (value) => Math.abs(shownMm(value) - value) > 0.005;
export const approx = (values) => (values.some(isRounded) ? '≈ ' : '');
export const dims = (values, lead = '') => `${approx(values)}${lead}${values.map(len).join(' × ')}`;

const steps = (value) => exactMm(value / current.fine);
export const floorLen = (value) => len(Math.floor(steps(value) + 1e-6) * current.fine + 0);
export const ceilLen = (value) => len(Math.ceil(steps(value) - 1e-6) * current.fine + 0);

export function fieldText(value) {
  if (current.den) return fraction(value, current.den, ' ');
  return String(tenths(value));
}

export const lengthInputMode = () => (current.den ? 'text' : 'decimal');

const MESSAGES = {
  inches: 'Enter a length such as 3 1/2, 3.5, 6\' 3" or 89mm.',
  mm: 'Enter a length such as 89, 89.5 or 3 1/2".',
  fixed: 'Enter a diameter in millimetres, such as 2.',
  zero: 'That fraction divides by 0. Enter one such as 1/2.',
};

const VULGAR = { '½': '1/2', '¼': '1/4', '¾': '3/4', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8' };
const DECIMAL = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;
const METRIC = { mm: 1, cm: 10, m: 1000 };
const ZERO = Symbol('zero');

function normalise(text) {
  return String(text)
    .toLowerCase()
    .replace(/[″”“]|''/g, '"')
    .replace(/[′’‘]/g, "'")
    .replace(/−/g, '-')
    .replace(/[½¼¾⅛⅜⅝⅞]/g, (glyph) => ` ${VULGAR[glyph]}`)
    .replace(/,(?=\d{3}(?!\d))/g, '')
    .replace(/,/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

function plainNumber(text) {
  let match = text.match(/^(\d+)[ -](\d+)\/(\d+)$/);
  if (match) return Number(match[3]) ? Number(match[1]) + Number(match[2]) / Number(match[3]) : ZERO;
  match = text.match(/^(\d+)\/(\d+)$/);
  if (match) return Number(match[2]) ? Number(match[1]) / Number(match[2]) : ZERO;
  return new RegExp(`^${DECIMAL}$`).test(text) ? Number(text) : null;
}

const INCH_MARK = / ?(?:"|inches|inch|in)$/;

function reading(text) {
  let match = text.match(new RegExp(`^(${DECIMAL}) ?(mm|cm|m)$`));
  if (match) return { value: Number(match[1]) * METRIC[match[2]], system: 'mm' };
  match = text.match(new RegExp(`^(${DECIMAL}) ?(?:'|ft)(?: ?(.*))?$`));
  if (match) {
    const rest = (match[2] ?? '').replace(INCH_MARK, '');
    const inches = rest === '' ? 0 : plainNumber(rest);
    if (inches === ZERO) return ZERO;
    return inches === null ? null : { value: (Number(match[1]) * 12 + inches) * INCH, system: 'in' };
  }
  if (INCH_MARK.test(text)) {
    const inches = plainNumber(text.replace(INCH_MARK, ''));
    return inches === null || inches === ZERO ? inches : { value: inches * INCH, system: 'in' };
  }
  const bare = plainNumber(text);
  return bare === null || bare === ZERO ? bare : { value: bare, system: null };
}

const UNFINISHED = [/\/$/, /(?:^|[ '])\d+[ -]\d*$/, /^[+-]$/, /\.$/, /[\d.] ?(?:m|c|i|inc|inche|f)$/];
const unfinished = (text) => UNFINISHED.some((pattern) => pattern.test(text));

function onGrid(value, unit) {
  if (!unit.den) return tenths(value);
  return exactMm((sixteenths(value, unit.den) / unit.den) * INCH);
}

export function parseLength(text, { unit = current.id, typing = false, fixed = false } = {}) {
  const field = UNITS[unit] ?? UNITS.mm;
  const refusal = fixed ? MESSAGES.fixed : field.den ? MESSAGES.inches : MESSAGES.mm;
  const clean = normalise(text);
  if (clean === '') return { empty: true };
  if (typing && unfinished(clean)) return { incomplete: true };
  const signed = clean.match(/^([+-]) ?(.*)$/);
  const body = signed ? signed[2] : clean;
  const read = body === '' || /^[+-]/.test(body) ? null : reading(body);
  if (read === ZERO) return { error: MESSAGES.zero };
  if (!read) return { error: refusal };
  const sign = signed?.[1] === '-' ? -1 : 1;
  const system = field.den ? 'in' : 'mm';
  const inField = read.system === null || read.system === system;
  const value = sign * (read.system === null && field.den ? read.value * INCH : read.value);
  return { mm: inField ? onGrid(value, field) : exactMm(value) };
}

const GAUGES = [[2.5, 3], [3, 4], [3.5, 6], [4, 8], [4.5, 9], [5, 10], [5.5, 12], [6.5, 14]];
const GAUGE_REACH_MM = 0.25;
const GAUGE_ERROR = `Enter a gauge ${GAUGES.slice(0, -1).map(([, gauge]) => `#${gauge}`).join(', ')} or #${GAUGES.at(-1)[1]}, or a diameter such as 4mm.`;

export function gaugeOf(diameter) {
  const nearest = GAUGES.reduce((best, each) => (Math.abs(each[0] - diameter) < Math.abs(best[0] - diameter) ? each : best));
  return Math.abs(nearest[0] - diameter) <= GAUGE_REACH_MM + 1e-9 ? nearest[1] : null;
}

export function gaugeText(diameter) {
  const gauge = gaugeOf(diameter);
  return gauge ? `#${gauge}` : `${fieldText(diameter)} ${current.name}`;
}

export function parseGauge(text, { typing = false } = {}) {
  const clean = normalise(text);
  if (clean === '') return { empty: true };
  if (typing && clean === '#') return { incomplete: true };
  const gauge = clean.match(/^#? ?(\d+)$/);
  if (gauge) {
    const size = GAUGES.find(([, each]) => each === Number(gauge[1]));
    return size ? { mm: size[0] } : { error: GAUGE_ERROR };
  }
  const length = parseLength(clean, { unit: current.id, typing });
  if (length.incomplete) return length;
  const read = reading(clean);
  if (!read || read === ZERO || read.system === null || length.error) return { error: GAUGE_ERROR };
  return { mm: exactMm(read.value) };
}

export function screwSize(diameter, length) {
  if (!current.den) return `${num(diameter)} × ${num(length)}`;
  const gauge = gaugeOf(diameter);
  return `${gauge ? `#${gauge}` : `⌀${len(diameter)}`} × ${len(length)}`;
}

export function nailSize(diameter, length) {
  return current.den ? `${num(diameter)} mm × ${len(length)}` : `${num(diameter)} × ${num(length)}`;
}

const BOARD_FEET_PER_M3 = 423.776;
const SQUARE_FEET_PER_M2 = 10.7639;
const POUNDS_PER_KG = 2.20462;

export function volume(m3, total = false) {
  if (!current.den) return { value: m3.toFixed(4), unit: 'm³' };
  return { value: (m3 * BOARD_FEET_PER_M3).toFixed(total ? 1 : 2), unit: 'bd ft' };
}

export function area(m2, total = false) {
  if (!current.den) return { value: m2.toFixed(2), unit: 'm²' };
  return { value: (m2 * SQUARE_FEET_PER_M2).toFixed(total ? 1 : 2), unit: 'ft²' };
}

export function weight(kg) {
  return current.den ? { value: `≈ ${(kg * POUNDS_PER_KG).toFixed(1)}`, unit: 'lb' } : { value: `≈ ${kg.toFixed(1)}`, unit: 'kg' };
}
