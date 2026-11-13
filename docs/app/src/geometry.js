export const TOUCH_MM = 0.05;
const EPS = 1e-9;
const PIECE_CORNERS = 12;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const along = (origin, ...terms) => origin.map((value, i) => terms.reduce((sum, [scale, vector]) => sum + scale * vector[i], value));

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

// Cuts the outline into vertical slabs at every corner and merges neighbouring slabs while the piece stays convex.
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
  const min = [0, 1, 2].map((i) => Math.min(...points.map((point) => point[i])));
  const max = [0, 1, 2].map((i) => Math.max(...points.map((point) => point[i])));
  return { min, max };
}

export function prism(polygon, { origin, u, v, w, depth }) {
  const half = depth / 2;
  const corners = polygon.flatMap(([s, t]) => {
    const base = along(origin, [s, u], [t, v]);
    return [along(base, [-half, w]), along(base, [half, w])];
  });
  const sides = polygon.map((point, i) => {
    const next = polygon[(i + 1) % polygon.length];
    return [next[0] - point[0], next[1] - point[1]];
  });
  return {
    corners,
    normals: [w, ...sides.map(([ds, dt]) => unit(along([0, 0, 0], [dt, u], [-ds, v])))].filter(Boolean),
    edges: [w, ...sides.map(([ds, dt]) => unit(along([0, 0, 0], [ds, u], [dt, v])))].filter(Boolean),
    box: boxOf(corners),
  };
}

export function solid(pieces) {
  return { pieces, box: boxOf(pieces.flatMap((piece) => [piece.box.min, piece.box.max])) };
}

function reach(corners, axis) {
  let low = Infinity;
  let high = -Infinity;
  for (const corner of corners) {
    const value = dot(corner, axis);
    if (value < low) low = value;
    if (value > high) high = value;
  }
  return [low, high];
}

const overlapOf = ([lowA, highA], [lowB, highB]) => Math.min(highA, highB) - Math.max(lowA, lowB);

export function boxesCross(a, b) {
  return [0, 1, 2].every((i) => overlapOf([a.min[i], a.max[i]], [b.min[i], b.max[i]]) > TOUCH_MM);
}

function* testAxes(a, b) {
  yield* a.normals;
  yield* b.normals;
  for (const first of a.edges) {
    for (const second of b.edges) {
      const axis = unit(cross(first, second));
      if (axis) yield axis;
    }
  }
}

function piecesClash(a, b) {
  if (!boxesCross(a.box, b.box)) return false;
  for (const axis of testAxes(a, b)) {
    if (overlapOf(reach(a.corners, axis), reach(b.corners, axis)) <= TOUCH_MM) return false;
  }
  return true;
}

export function solidsClash(a, b) {
  if (!boxesCross(a.box, b.box)) return false;
  return a.pieces.some((piece) => boxesCross(piece.box, b.box) && b.pieces.some((other) => piecesClash(piece, other)));
}
