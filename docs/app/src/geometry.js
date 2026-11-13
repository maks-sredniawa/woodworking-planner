export const TOUCH_MM = 0.05;
const EPS = 1e-9;
const PIECE_CORNERS = 12;

function unit(vector) {
  const size = Math.hypot(...vector);
  return size < 1e-6 ? null : vector.map((value) => value / size);
}

const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function extend(chain, point, bulge) {
  if (chain.length >= 2) {
    const bend = turn(chain.at(-2), chain.at(-1), point) * bulge;
    if (Math.abs(bend) < EPS) {
      chain[chain.length - 1] = point;
      return;
    }
  }
  chain.push(point);
}

function fits(chain, point, bulge) {
  return chain.length < 2 || turn(chain.at(-2), chain.at(-1), point) * bulge >= -EPS;
}

function closeChains({ bottom, top }) {
  const ring = [...bottom, ...[...top].reverse()];
  return ring.filter((point, i) => {
    const next = ring[(i + 1) % ring.length];
    return Math.abs(point[0] - next[0]) > EPS || Math.abs(point[1] - next[1]) > EPS;
  });
}

export function convexParts({ points, holes = [] }) {
  const rings = [points, ...holes];
  const edges = rings.flatMap((ring) =>
    ring
      .map((point, i) => [point, ring[(i + 1) % ring.length]])
      .filter(([p, q]) => Math.abs(p[0] - q[0]) > EPS)
      .map(([p, q]) => (p[0] < q[0] ? [p, q] : [q, p])),
  );
  const xs = [...new Set(rings.flat().map(([u]) => u))].sort((a, b) => a - b);
  const heightAt = ([p, q], u) => p[1] + ((q[1] - p[1]) * (u - p[0])) / (q[0] - p[0]);
  const done = [];
  let open = [];
  for (let k = 0; k + 1 < xs.length; k++) {
    const a = xs[k];
    const b = xs[k + 1];
    const middle = (a + b) / 2;
    const crossing = edges
      .filter(([p, q]) => p[0] <= middle && q[0] >= middle)
      .map((edge) => ({ low: heightAt(edge, a), high: heightAt(edge, b), mid: heightAt(edge, middle) }))
      .sort((one, two) => one.mid - two.mid);
    const next = [];
    for (let i = 0; i + 1 < crossing.length; i += 2) {
      const [below, above] = [crossing[i], crossing[i + 1]];
      const [bottomEnd, topEnd] = [[b, below.high], [b, above.high]];
      const piece = open.find(
        (each) =>
          Math.abs(each.bottom.at(-1)[1] - below.low) < EPS &&
          Math.abs(each.top.at(-1)[1] - above.low) < EPS &&
          fits(each.bottom, bottomEnd, 1) &&
          fits(each.top, topEnd, -1) &&
          each.bottom.length + each.top.length < PIECE_CORNERS,
      );
      if (piece) {
        open = open.filter((each) => each !== piece);
        extend(piece.bottom, bottomEnd, 1);
        extend(piece.top, topEnd, -1);
        next.push(piece);
      } else {
        next.push({ bottom: [[a, below.low], bottomEnd], top: [[a, above.low], topEnd] });
      }
    }
    done.push(...open);
    open = next;
  }
  done.push(...open);
  return done.map(closeChains).filter((ring) => ring.length >= 3);
}

function boxOf(points) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let i = 0; i < 3; i++) {
      if (point[i] < min[i]) min[i] = point[i];
      if (point[i] > max[i]) max[i] = point[i];
    }
  }
  return { min, max };
}

const W = [0, 0, 1];

export function prism(polygon, depth) {
  const sides = polygon.map((point, i) => {
    const next = polygon[(i + 1) % polygon.length];
    return [next[0] - point[0], next[1] - point[1], 0];
  });
  return {
    polygon,
    depth,
    normals: [W, ...sides.map(([ds, dt]) => unit([dt, -ds, 0]))].filter(Boolean),
    edges: [W, ...sides.map(unit)].filter(Boolean),
  };
}

export function placeSolid(pieces, { origin, u, v, w }) {
  const turn = ([a, b, c]) => [a * u[0] + b * v[0] + c * w[0], a * u[1] + b * v[1] + c * w[1], a * u[2] + b * v[2] + c * w[2]];
  const placed = pieces.map(({ polygon, depth, normals, edges }) => {
    const middle = new Float64Array(polygon.length * 3);
    polygon.forEach(([s, t], i) => {
      for (let k = 0; k < 3; k++) middle[3 * i + k] = origin[k] + s * u[k] + t * v[k];
    });
    const half = w.map((value) => (value * depth) / 2);
    const corners = polygon.flatMap((_, i) => {
      const point = [middle[3 * i], middle[3 * i + 1], middle[3 * i + 2]];
      return [point.map((value, k) => value - half[k]), point.map((value, k) => value + half[k])];
    });
    return { corners, middle, half, normals: normals.map(turn), edges: edges.map(turn), w, box: boxOf(corners) };
  });
  return { pieces: placed, box: boxOf(placed.flatMap((piece) => [piece.box.min, piece.box.max])) };
}

export function moveSolid(solid, offset) {
  if (offset.every((value) => value === 0)) return solid;
  const shift = (point) => point.map((value, k) => value + offset[k]);
  const pieces = solid.pieces.map((piece) => ({
    ...piece,
    corners: piece.corners.map(shift),
    middle: piece.middle.map((value, i) => value + offset[i % 3]),
    box: { min: shift(piece.box.min), max: shift(piece.box.max) },
  }));
  return { pieces, box: { min: shift(solid.box.min), max: shift(solid.box.max) } };
}

let shadowLow = 0;
let shadowHigh = 0;

function castShadow(piece, x, y, z) {
  const { middle, half } = piece;
  shadowLow = Infinity;
  shadowHigh = -Infinity;
  for (let i = 0; i < middle.length; i += 3) {
    const value = middle[i] * x + middle[i + 1] * y + middle[i + 2] * z;
    if (value < shadowLow) shadowLow = value;
    if (value > shadowHigh) shadowHigh = value;
  }
  const thick = Math.abs(half[0] * x + half[1] * y + half[2] * z);
  shadowLow -= thick;
  shadowHigh += thick;
}

const overlapOf = ([lowA, highA], [lowB, highB]) => Math.min(highA, highB) - Math.max(lowA, lowB);

export function boxesCross(a, b) {
  for (let i = 0; i < 3; i++) if (Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]) <= TOUCH_MM) return false;
  return true;
}

const PARALLEL = 1 - 1e-9;

function eachAxis(a, b, test) {
  for (const normal of a.normals) if (!test(normal[0], normal[1], normal[2])) return false;
  for (const normal of b.normals) if (!test(normal[0], normal[1], normal[2])) return false;
  for (const e of a.edges) {
    for (const f of b.edges) {
      let x = e[1] * f[2] - e[2] * f[1];
      let y = e[2] * f[0] - e[0] * f[2];
      let z = e[0] * f[1] - e[1] * f[0];
      const size = Math.hypot(x, y, z);
      if (size < 1e-6) continue;
      x /= size;
      y /= size;
      z /= size;
      if (Math.abs(x * a.w[0] + y * a.w[1] + z * a.w[2]) >= PARALLEL || Math.abs(x * b.w[0] + y * b.w[1] + z * b.w[2]) >= PARALLEL) continue;
      if (!test(x, y, z)) return false;
    }
  }
  return true;
}

function piecesClash(a, b) {
  if (!boxesCross(a.box, b.box)) return false;
  return eachAxis(a, b, (x, y, z) => {
    castShadow(a, x, y, z);
    const [fromA, toA] = [shadowLow, shadowHigh];
    castShadow(b, x, y, z);
    return Math.min(toA, shadowHigh) - Math.max(fromA, shadowLow) > TOUCH_MM;
  });
}

export function solidsClash(a, b) {
  if (!boxesCross(a.box, b.box)) return false;
  return a.pieces.some((piece) => boxesCross(piece.box, b.box) && b.pieces.some((other) => piecesClash(piece, other)));
}

function hull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const half = (list) => {
    const chain = [];
    for (const point of list) {
      while (chain.length >= 2 && turn(chain.at(-2), chain.at(-1), point) <= EPS) chain.pop();
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

function prismEdges(count) {
  return Array.from({ length: count }, (_, j) => {
    const next = (j + 1) % count;
    return [[2 * j, 2 * j + 1], [2 * j, 2 * next], [2 * j + 1, 2 * next + 1]];
  }).flat();
}

function footprint(piece, axis, low, high) {
  if (piece.box.max[axis] < low || piece.box.min[axis] > high) return null;
  const inside = piece.corners.filter((corner) => corner[axis] >= low && corner[axis] <= high);
  const cuts = prismEdges(piece.corners.length / 2).flatMap(([i, j]) => {
    const [p, q] = [piece.corners[i], piece.corners[j]];
    return [low, high]
      .filter((level) => (p[axis] - level) * (q[axis] - level) < 0)
      .map((level) => p.map((value, k) => value + ((q[k] - value) * (level - p[axis])) / (q[axis] - p[axis])));
  });
  const others = [0, 1, 2].filter((k) => k !== axis);
  const shape = hull([...inside, ...cuts].map((point) => others.map((k) => point[k])));
  return shape.length >= 3 ? shape : null;
}

function clip(subject, by) {
  let result = subject;
  for (let i = 0; i < by.length && result.length; i++) {
    const [a, b] = [by[i], by[(i + 1) % by.length]];
    const input = result;
    result = [];
    input.forEach((point, j) => {
      const previous = input[(j + input.length - 1) % input.length];
      const [now, before] = [turn(a, b, point) >= 0, turn(a, b, previous) >= 0];
      if (now !== before) {
        const [dp, dq] = [turn(a, b, previous), turn(a, b, point)];
        const share = dp / (dp - dq);
        result.push([previous[0] + (point[0] - previous[0]) * share, previous[1] + (point[1] - previous[1]) * share]);
      }
      if (now) result.push(point);
    });
  }
  return result;
}

export function meetingRegion(a, b, axis, at) {
  const [low, high] = [at - TOUCH_MM, at + TOUCH_MM];
  const near = (shape) => shape.pieces.map((piece) => footprint(piece, axis, low, high)).filter(Boolean);
  const [mine, theirs] = [near(a), near(b)];
  const others = [0, 1, 2].filter((k) => k !== axis);
  let region = null;
  for (const one of mine) {
    for (const two of theirs) {
      const shared = clip(one, two);
      if (shared.length < 3) continue;
      const spans = [0, 1].map((k) => [Math.min(...shared.map((point) => point[k])), Math.max(...shared.map((point) => point[k]))]);
      if (spans.some(([from, to]) => to - from <= TOUCH_MM)) continue;
      region ??= Object.fromEntries(others.map((k) => [k, [Infinity, -Infinity]]));
      others.forEach((k, i) => {
        region[k] = [Math.min(region[k][0], spans[i][0]), Math.max(region[k][1], spans[i][1])];
      });
    }
  }
  return region;
}

function pieceSweep(a, b, axis) {
  let [from, to] = [-Infinity, Infinity];
  const meets = eachAxis(a, b, (x, y, z) => {
    castShadow(a, x, y, z);
    const [fromA, toA] = [shadowLow, shadowHigh];
    castShadow(b, x, y, z);
    const rate = [x, y, z][axis];
    if (Math.abs(rate) < 1e-9) return Math.min(toA, shadowHigh) - Math.max(fromA, shadowLow) > TOUCH_MM;
    const [one, two] = [(shadowLow - toA) / rate, (shadowHigh - fromA) / rate];
    from = Math.max(from, Math.min(one, two));
    to = Math.min(to, Math.max(one, two));
    return to - from > TOUCH_MM;
  });
  return meets ? [from, to] : null;
}

export function sweepSpans(a, b, axis, within = Infinity) {
  const across = [0, 1, 2].filter((k) => k !== axis);
  const passes = (one, two) =>
    across.every((k) => overlapOf([one.min[k], one.max[k]], [two.min[k], two.max[k]]) > TOUCH_MM) &&
    two.min[axis] - one.max[axis] <= within &&
    one.min[axis] - two.max[axis] <= within;
  if (!passes(a.box, b.box)) return [];
  const spans = [];
  for (const piece of a.pieces) {
    if (!passes(piece.box, b.box)) continue;
    for (const other of b.pieces) {
      const span = passes(piece.box, other.box) && pieceSweep(piece, other, axis);
      if (span) spans.push(span);
    }
  }
  spans.sort((one, two) => one[0] - two[0]);
  return spans.reduce((merged, span) => {
    const last = merged.at(-1);
    if (last && span[0] <= last[1] + EPS) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
    return merged;
  }, []);
}
