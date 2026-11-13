export const MIN_POINTS = 3;
export const MAX_POINTS = 64;
export const MAX_DRAWN_POINTS = 24;
export const SAME_PLACE_MM = 1;
const STEP_RAD = (4 * Math.PI) / 180;
const CHECK_SEGMENTS = 8;

const round = (value) => Math.round(value * 10) / 10;
const next = (points, i) => points[(i + 1) % points.length];

export function point(x, y, bend = 0) {
  return { x, y, bend };
}

function chordArea(points) {
  let sum = 0;
  points.forEach((a, i) => {
    const b = next(points, i);
    sum += a.x * b.y - b.x * a.y;
  });
  return sum / 2;
}

export function winding(points) {
  return chordArea(points) < 0 ? -1 : 1;
}

export function halfEdge(points, i) {
  const a = points[i];
  const b = next(points, i);
  return Math.hypot(b.x - a.x, b.y - a.y) / 2;
}

function outward(points, i) {
  const a = points[i];
  const b = next(points, i);
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const turn = winding(points);
  return [(turn * (b.y - a.y)) / length, (turn * (a.x - b.x)) / length];
}

export function apex(points, i) {
  const a = points[i];
  const b = next(points, i);
  const [nx, ny] = outward(points, i);
  const bend = points[i].bend;
  return [(a.x + b.x) / 2 + nx * bend, (a.y + b.y) / 2 + ny * bend];
}

export function bendToward(points, i, [x, y]) {
  const a = points[i];
  const b = next(points, i);
  const [nx, ny] = outward(points, i);
  const along = (x - (a.x + b.x) / 2) * nx + (y - (a.y + b.y) / 2) * ny;
  const most = halfEdge(points, i);
  return Math.max(-most, Math.min(most, along));
}

function circle(points, i) {
  const half = halfEdge(points, i);
  const bend = Math.max(-half, Math.min(half, points[i].bend));
  const radius = (half * half + bend * bend) / (2 * Math.abs(bend));
  const [nx, ny] = outward(points, i);
  const [px, py] = apex(points, i);
  const side = Math.sign(bend);
  return { radius, cx: px - nx * side * radius, cy: py - ny * side * radius, half, bend };
}

function edgePoints(points, i, segments) {
  const a = points[i];
  if (!a.bend || !halfEdge(points, i)) return [[a.x, a.y]];
  const { radius, cx, cy } = circle(points, i);
  const [px, py] = apex(points, i);
  const start = Math.atan2(a.y - cy, a.x - cx);
  let half = Math.atan2(py - cy, px - cx) - start;
  if (half > Math.PI) half -= 2 * Math.PI;
  if (half < -Math.PI) half += 2 * Math.PI;
  const count = segments ?? Math.max(2, Math.ceil(Math.abs(2 * half) / STEP_RAD));
  return Array.from({ length: count }, (_, k) => {
    const angle = start + (2 * half * k) / count;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });
}

export function polygon(points, segments) {
  return points.flatMap((_, i) => edgePoints(points, i, segments));
}

export function edgePath(points, i, segments) {
  return [...edgePoints(points, i, segments), [next(points, i).x, next(points, i).y]];
}

function extremes(points, i) {
  const a = points[i];
  if (!a.bend || !halfEdge(points, i)) return [];
  const { radius, cx, cy } = circle(points, i);
  const [px, py] = apex(points, i);
  const start = Math.atan2(a.y - cy, a.x - cx);
  const middle = Math.atan2(py - cy, px - cx);
  const reach = Math.abs(Math.atan2(Math.sin(middle - start), Math.cos(middle - start)));
  return [0, 1, 2, 3]
    .map((quarter) => (quarter * Math.PI) / 2)
    .filter((angle) => Math.abs(Math.atan2(Math.sin(angle - middle), Math.cos(angle - middle))) <= reach)
    .map((angle) => [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
}

export function box(points) {
  const all = [...points.map(({ x, y }) => [x, y]), ...points.flatMap((_, i) => extremes(points, i))];
  const xs = all.map(([x]) => x);
  const ys = all.map(([, y]) => y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

export function area(points) {
  const straight = Math.abs(chordArea(points));
  return points.reduce((sum, each, i) => {
    if (!each.bend || !halfEdge(points, i)) return sum;
    const { radius, half, bend } = circle(points, i);
    const angle = 4 * Math.atan(Math.abs(bend) / half);
    return sum + Math.sign(bend) * ((radius * radius) / 2) * (angle - Math.sin(angle));
  }, straight);
}

function side(p, q, r) {
  return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
}

function within(p, q, r) {
  return Math.min(p[0], q[0]) - 1e-9 <= r[0] && r[0] <= Math.max(p[0], q[0]) + 1e-9 && Math.min(p[1], q[1]) - 1e-9 <= r[1] && r[1] <= Math.max(p[1], q[1]) + 1e-9;
}

function segmentsMeet(p1, p2, q1, q2) {
  const d1 = side(q1, q2, p1);
  const d2 = side(q1, q2, p2);
  const d3 = side(p1, p2, q1);
  const d4 = side(p1, p2, q2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (
    (d1 === 0 && within(q1, q2, p1)) ||
    (d2 === 0 && within(q1, q2, p2)) ||
    (d3 === 0 && within(p1, p2, q1)) ||
    (d4 === 0 && within(p1, p2, q2))
  );
}

function foldsBack(from, shared, to) {
  const turn = side(from, shared, to);
  const scale = Math.hypot(shared[0] - from[0], shared[1] - from[1]) * Math.hypot(to[0] - shared[0], to[1] - shared[1]);
  const backward = (shared[0] - from[0]) * (to[0] - shared[0]) + (shared[1] - from[1]) * (to[1] - shared[1]) < 0;
  return backward && Math.abs(turn) <= 1e-9 * scale;
}

function edgesCross(paths, i, j) {
  const count = paths.length;
  const after = (i + 1) % count === j;
  const before = (j + 1) % count === i;
  const a = paths[i];
  const b = paths[j];
  for (let s = 0; s < a.length - 1; s++) {
    for (let t = 0; t < b.length - 1; t++) {
      if (after && s === a.length - 2 && t === 0) {
        if (foldsBack(a[s], a[s + 1], b[t + 1])) return true;
        continue;
      }
      if (before && s === 0 && t === b.length - 2) {
        if (foldsBack(b[t + 1], b[t], a[s + 1])) return true;
        continue;
      }
      if (segmentsMeet(a[s], a[s + 1], b[t], b[t + 1])) return true;
    }
  }
  return false;
}

export function crossing(points) {
  const paths = points.map((_, i) => edgePath(points, i, CHECK_SEGMENTS));
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (edgesCross(paths, i, j)) return [i, j];
    }
  }
  return null;
}

export function outlineProblem(points, maxSize) {
  const size = box(points);
  if (size.maxX - size.minX > maxSize || size.maxY - size.minY > maxSize) return { kind: 'big' };
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < SAME_PLACE_MM) return { kind: 'together', points: [i, j] };
    }
  }
  if (area(points) < 1) return { kind: 'flat' };
  const crossed = crossing(points);
  if (crossed) return { kind: 'crossing', edges: crossed };
  return null;
}

function clampBend(points, i) {
  const most = Math.floor(halfEdge(points, i) * 10) / 10;
  const bend = points[i].bend;
  if (Math.abs(bend) <= most) return points[i];
  return { ...points[i], bend: Math.sign(bend) * most };
}

export function fitBends(points) {
  return points.map((_, i) => clampBend(points, i));
}

export function movePoint(points, i, x, y) {
  return fitBends(points.map((each, k) => (k === i ? { ...each, x: round(x), y: round(y) } : each)));
}

export function setBend(points, i, bend) {
  return points.map((each, k) => (k === i ? { ...each, bend: round(bend) } : each));
}

export function addPoint(points, i) {
  const a = points[i];
  const [x, y] = apex(points, i);
  const split = (bend) => {
    if (!bend) return 0;
    const { radius, half } = circle(points, i);
    const quarter = Math.atan(Math.abs(bend) / half);
    return Math.sign(bend) * radius * (1 - Math.cos(quarter));
  };
  const halfBend = round(split(a.bend));
  const added = { x: round(x), y: round(y), bend: halfBend };
  return [...points.slice(0, i), { ...a, bend: halfBend }, added, ...points.slice(i + 1)];
}

export function removePoint(points, i) {
  const kept = points.filter((_, k) => k !== i);
  return fitBends(kept);
}

export function rebase(points) {
  const size = box(points);
  return points.map(({ x, y, bend }) => ({ x: round(x - size.minX), y: round(y - size.minY), bend: round(bend) }));
}

export function scale(points, sx, sy) {
  const size = box(points);
  const at = (x, y) => [size.minX + (x - size.minX) * sx, size.minY + (y - size.minY) * sy];
  const moved = points.map(({ x, y }) => {
    const [nx, ny] = at(x, y);
    return { x: round(nx), y: round(ny), bend: 0 };
  });
  return fitBends(
    moved.map((each, i) => {
      if (!points[i].bend) return each;
      const [ax, ay] = at(...apex(points, i));
      return { ...each, bend: round(bendToward(moved, i, [ax, ay])) };
    }),
  );
}

export function arcBend(radius, angle) {
  return radius * (1 - Math.cos(angle / 2));
}

function distanceToLine([x, y], a, b) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) / length;
}

function simplify(line, tolerance) {
  const keep = new Set([0, line.length - 1]);
  const walk = (from, to) => {
    let far = -1;
    let most = tolerance;
    for (let k = from + 1; k < to; k++) {
      const distance = Math.abs(distanceToLine(line[k], line[from], line[to]));
      if (distance > most) {
        most = distance;
        far = k;
      }
    }
    if (far < 0) return;
    keep.add(far);
    walk(from, far);
    walk(far, to);
  };
  walk(0, line.length - 1);
  return [...keep].sort((a, b) => a - b);
}

function fitEdge(line, from, to) {
  const a = line[from];
  const b = line[to];
  const half = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
  const inside = line.slice(from + 1, to);
  const straightError = Math.max(0, ...inside.map((p) => Math.abs(distanceToLine(p, a, b))));
  if (!inside.length || !half) return { bend: 0, error: straightError };
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const middle = inside.reduce((best, p) => (Math.hypot(p[0] - mid[0], p[1] - mid[1]) < Math.hypot(best[0] - mid[0], best[1] - mid[1]) ? p : best));
  const sag = -distanceToLine(middle, a, b);
  if (Math.abs(sag) > half || Math.abs(sag) < 1) return { bend: 0, error: straightError };
  const radius = (half * half + sag * sag) / (2 * Math.abs(sag));
  const [nx, ny] = [(b[1] - a[1]) / (2 * half), (a[0] - b[0]) / (2 * half)];
  const cx = mid[0] + nx * sag - nx * Math.sign(sag) * radius;
  const cy = mid[1] + ny * sag - ny * Math.sign(sag) * radius;
  const arcError = Math.max(...inside.map((p) => Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - radius)));
  return arcError < straightError / 2 ? { bend: sag, error: arcError } : { bend: 0, error: straightError };
}

export function fromStroke(stroke, minSize = 10) {
  const xs = stroke.map(([x]) => x);
  const ys = stroke.map(([, y]) => y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (stroke.length < 3 || width < minSize || height < minSize) return null;
  const signed = stroke.reduce((sum, p, i) => {
    const q = stroke[(i + 1) % stroke.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);
  const ordered = signed < 0 ? [...stroke].reverse() : stroke;
  const line = [...ordered, ordered[0]];
  let tolerance = Math.max(0.5, Math.hypot(width, height) / 100);
  let kept = simplify(line, tolerance);
  while (kept.length - 1 > MAX_DRAWN_POINTS) {
    tolerance *= 1.3;
    kept = simplify(line, tolerance);
  }
  let merged = true;
  while (merged && kept.length - 1 > MIN_POINTS) {
    merged = false;
    for (let k = 1; k < kept.length - 1 && kept.length - 1 > MIN_POINTS; k++) {
      if (fitEdge(line, kept[k - 1], kept[k + 1]).error <= tolerance) {
        kept.splice(k, 1);
        merged = true;
      }
    }
  }
  const corners = kept.slice(0, -1);
  return corners.map((index, k) => {
    const [x, y] = line[index];
    const { bend } = fitEdge(line, index, kept[k + 1]);
    return point(round(x), round(y), round(bend));
  });
}
