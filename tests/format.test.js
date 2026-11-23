import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  area,
  ceilLen,
  dims,
  exactMm,
  fieldText,
  floorLen,
  gaugeText,
  isRounded,
  len,
  lenUnit,
  num,
  parseGauge,
  parseLength,
  screwSize,
  setUnits,
  units,
  unitName,
  volume,
  weight,
} from '../docs/app/src/format.js';

const nb = (text) => text.replaceAll(' ', ' ');
const oldMm = (value) => `${Number(value).toLocaleString('en-GB', { maximumFractionDigits: 1 })}`;

afterEach(() => setUnits('mm'));

test('the unit starts as millimetres and an unknown unit falls back to it', () => {
  assert.equal(units().id, 'mm');
  setUnits('in16');
  assert.equal(units().id, 'in16');
  assert.equal(unitName(), 'in');
  setUnits('furlongs');
  assert.equal(units().id, 'mm');
  assert.equal(unitName(), 'mm');
});

test('exactMm keeps five decimals and never gives -0', () => {
  assert.equal(exactMm(0.79375), 0.79375);
  assert.equal(exactMm(19.05 + 19.05), 38.1);
  assert.equal(exactMm(0.1 + 0.2), 0.3);
  assert.ok(Object.is(exactMm(-0.000001), 0));
});

test('in millimetres len and num print what mm() printed', () => {
  for (const value of [0, 18, 612.3, 2440, -5, 10000, 88.9]) {
    assert.equal(len(value), oldMm(value));
    assert.equal(num(value), oldMm(value));
  }
  assert.equal(lenUnit(89), '89 mm');
});

test('in inches a length is a reduced fraction to the nearest 1/16', () => {
  setUnits('in16');
  assert.equal(len(88.9), nb('3 1/2'));
  assert.equal(len(12.7), '1/2');
  assert.equal(len(25.4), '1');
  assert.equal(len(0), '0');
  assert.equal(len(0.3), '0');
  assert.equal(len(-0.3), '0');
  assert.equal(len(-6.35), '-1/4');
  assert.equal(len(600), nb('23 5/8'));
  assert.equal(len(2440), nb('96 1/16'));
  assert.equal(len(18), '11/16');
  assert.equal(len(10000), nb('393 11/16'));
  assert.equal(lenUnit(88.9), '3\u00a01/2 in');
  assert.equal(num(90), '90');
});

test('at 1/32 the finer fraction is used', () => {
  setUnits('in32');
  assert.equal(len(18), '23/32');
  assert.equal(len(0.79375), '1/32');
  assert.equal(len(88.9), nb('3 1/2'));
  assert.equal(num(90), '90');
});

test('isRounded says when the shown value is not the kept one', () => {
  assert.equal(isRounded(600), false);
  assert.equal(isRounded(19.05), true);
  assert.equal(isRounded(300.00000000000006), false);
  setUnits('in16');
  assert.equal(isRounded(18), true);
  assert.equal(isRounded(19.05), false);
  setUnits('in32');
  assert.equal(isRounded(0.79375), false);
});

test('dims leads a rounded chain with one ≈', () => {
  assert.equal(dims([600, 300, 18]), '600 × 300 × 18');
  assert.equal(dims([400, 18], '⌀'), '⌀400 × 18');
  setUnits('in16');
  assert.equal(dims([600, 300, 18]), '≈ 23\u00a05/8 × 11\u00a013/16 × 11/16');
  assert.equal(dims([406.4, 19.05], '⌀'), '⌀16 × 3/4');
});

test('limits floor and ceil to the grid so the number shown is accepted', () => {
  assert.equal(floorLen(10000), '10,000');
  assert.equal(floorLen(122), '122');
  assert.equal(ceilLen(0.1), '0.1');
  setUnits('in16');
  assert.equal(floorLen(10000), nb('393 11/16'));
  assert.equal(floorLen(100), nb('3 7/8'));
  assert.equal(ceilLen(100), nb('3 15/16'));
  assert.equal(floorLen(88.9), nb('3 1/2'));
  assert.equal(ceilLen(88.9), nb('3 1/2'));
  assert.equal(ceilLen(16), '11/16');
});

test('fieldText has no grouping, a plain space and no ≈', () => {
  assert.equal(fieldText(10000), '10000');
  assert.equal(fieldText(612.345), '612.3');
  assert.equal(fieldText(-0.01), '0');
  setUnits('in16');
  assert.equal(fieldText(88.9), '3 1/2');
  assert.equal(fieldText(18), '11/16');
});

const KEPT = [
  ['89', 89, 2260.6, 2260.6],
  ['3 1/2"', 88.9, 88.9, 88.9],
  ['3-1/2"', 88.9, 88.9, 88.9],
  ['3.5"', 88.9, 88.9, 88.9],
  ['3½"', 88.9, 88.9, 88.9],
  ['3 1/2 in', 88.9, 88.9, 88.9],
  ['3 1/2 inches', 88.9, 88.9, 88.9],
  ['3 1/2″', 88.9, 88.9, 88.9],
  ['3 1/2', 3.5, 88.9, 88.9],
  ['89mm', 89, 89, 89],
  ['89 MM', 89, 89, 89],
  ['8.9cm', 89, 89, 89],
  [`6' 3"`, 1905, 1905, 1905],
  [`6'3`, 1905, 1905, 1905],
  ['6ft 3in', 1905, 1905, 1905],
  ['6’ 3”', 1905, 1905, 1905],
  [`6'`, 1828.8, 1828.8, 1828.8],
  [`6' 14"`, 2184.4, 2184.4, 2184.4],
  ['3 5/4', 4.3, 107.95, 107.95],
  ['0.7', 0.7, 17.4625, 17.4625],
  ['3 1/64', 3, 76.2, 76.99375],
  ['1/3', 0.3, 7.9375, 8.73125],
  ['89.04', 89, 2262.1875, 2261.39375],
  ['-1/4', -0.3, -6.35, -6.35],
  ['−1/4', -0.3, -6.35, -6.35],
  ['2,440', 2440, 61976, 61976],
  ['3,5', 3.5, 88.9, 88.9],
  ['.5', 0.5, 12.7, 12.7],
  ['  3  1/2  ', 3.5, 88.9, 88.9],
];

test('parseLength keeps the value the table in the spec gives, in every unit', () => {
  for (const [text, mm, in16, in32] of KEPT) {
    assert.deepEqual(parseLength(text, { unit: 'mm' }), { mm }, `${text} in mm`);
    assert.deepEqual(parseLength(text, { unit: 'in16' }), { mm: in16 }, `${text} at 1/16`);
    assert.deepEqual(parseLength(text, { unit: 'in32' }), { mm: in32 }, `${text} at 1/32`);
  }
});

test('parseLength takes the current unit when none is given', () => {
  setUnits('in16');
  assert.deepEqual(parseLength('3 1/2'), { mm: 88.9 });
});

test('parseLength waits while a length is still being typed', () => {
  for (const text of ['3 1/', '1/', '3 1', '3-', '3-1', '-', '+', '.', '3.', '89m', '3 i', '6f', '8.9c', '3 inc', `6' 3 1`]) {
    assert.deepEqual(parseLength(text, { unit: 'in16', typing: true }), { incomplete: true }, text);
  }
  assert.deepEqual(parseLength('', { unit: 'in16', typing: true }), { empty: true });
  assert.deepEqual(parseLength('   ', { unit: 'mm' }), { empty: true });
});

test('once typing is over an unfinished length is not understood, and 89m is metres', () => {
  for (const text of ['3 1/', '3 1', '3-', '-', '.', '3 i', '6f']) {
    assert.deepEqual(parseLength(text, { unit: 'in16' }), { error: 'Enter a length such as 3 1/2, 3.5, 6\' 3" or 89mm.' }, text);
  }
  assert.deepEqual(parseLength('2m', { unit: 'in16' }), { mm: 2000 });
});

test('parseLength refuses what is not a length', () => {
  const inches = 'Enter a length such as 3 1/2, 3.5, 6\' 3" or 89mm.';
  const millimetres = 'Enter a length such as 89, 89.5 or 3 1/2".';
  for (const text of ['abc', '1/2/3', '3..5', '3 mm 4', '--3', `5'6'`, '1e3', '3.5 1/2', '1/2mm', '3 1/2 1/4']) {
    assert.deepEqual(parseLength(text, { unit: 'in16', typing: true }), { error: inches }, text);
    assert.deepEqual(parseLength(text, { unit: 'mm' }), { error: millimetres }, text);
  }
  for (const text of ['3 1/0', '1/0', `6' 1/0"`]) {
    assert.deepEqual(parseLength(text, { unit: 'in16' }), { error: 'That fraction divides by 0. Enter one such as 1/2.' }, text);
  }
});

test('a field that is always in millimetres keeps them and says so', () => {
  setUnits('in16');
  assert.deepEqual(parseLength('2', { unit: 'mm', fixed: true }), { mm: 2 });
  assert.deepEqual(parseLength('2.25', { unit: 'mm', fixed: true }), { mm: 2.3 });
  assert.deepEqual(parseLength('1/16"', { unit: 'mm', fixed: true }), { mm: 1.5875 });
  assert.deepEqual(parseLength('abc', { unit: 'mm', fixed: true }), { error: 'Enter a diameter in millimetres, such as 2.' });
});

test('screwSize gives millimetres or a gauge', () => {
  assert.equal(screwSize(4, 40), '4 × 40');
  setUnits('in16');
  assert.equal(screwSize(4, 40), '#8 × 1\u00a09/16');
  assert.equal(screwSize(3.8, 40).split(' ')[0], '#8');
  assert.equal(screwSize(8, 76.2), '⌀5/16 × 3');
});

test('a gauge field shows the gauge and takes a gauge or a marked length', () => {
  setUnits('in16');
  assert.equal(gaugeText(4), '#8');
  assert.equal(gaugeText(5), '#10');
  assert.equal(gaugeText(6.5), '#14');
  assert.equal(gaugeText(8), '5/16 in');
  assert.deepEqual(parseGauge('#8'), { mm: 4 });
  assert.deepEqual(parseGauge('10'), { mm: 5 });
  assert.deepEqual(parseGauge(' # 6 '), { mm: 3.5 });
  assert.deepEqual(parseGauge('4mm'), { mm: 4 });
  assert.deepEqual(parseGauge('5/32"'), { mm: 3.96875 });
  assert.deepEqual(parseGauge('#', { typing: true }), { incomplete: true });
  assert.deepEqual(parseGauge(''), { empty: true });
  const refused = { error: 'Enter a gauge #3, #4, #6, #8, #9, #10, #12 or #14, or a diameter such as 4mm.' };
  for (const text of ['#7', '15', 'abc', '#', '5/32']) assert.deepEqual(parseGauge(text), refused, text);
});

test('volume, face and weight read in timber units in inches', () => {
  assert.deepEqual(volume(0.027, true), { value: '0.0270', unit: 'm³' });
  assert.deepEqual(volume(0.00271), { value: '0.0027', unit: 'm³' });
  assert.deepEqual(area(2.03, true), { value: '2.03', unit: 'm²' });
  assert.deepEqual(weight(14.6), { value: '≈ 14.6', unit: 'kg' });
  setUnits('in16');
  assert.deepEqual(volume(0.027, true), { value: '11.4', unit: 'bd ft' });
  assert.deepEqual(volume(0.0048), { value: '2.03', unit: 'bd ft' });
  assert.deepEqual(area(2.03, true), { value: '21.9', unit: 'ft²' });
  assert.deepEqual(area(0.8), { value: '8.61', unit: 'ft²' });
  assert.deepEqual(weight(14.6), { value: '≈ 32.2', unit: 'lb' });
});

test('no source file still calls or imports mm()', () => {
  const dir = new URL('../docs/app/src/', import.meta.url);
  for (const name of readdirSync(dir)) {
    const source = readFileSync(new URL(name, dir), 'utf8');
    assert.ok(!/[^\w.]mm\(/.test(source), `${name} calls mm()`);
    assert.ok(!/import \{[^}]*\bmm\b[^}]*\} from/.test(source), `${name} imports mm`);
  }
});
