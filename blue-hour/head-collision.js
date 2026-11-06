// The hull keeps the sampled face oval convex even when a few landmarks
// fold inward during a turn. All coordinates are in preview CSS pixels.
export function buildFaceHull(points) {
  if (points.length < 3 || points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return null;
  points.sort(([ax, ay], [bx, by]) => ax - bx || ay - by);
  const turn = ([ax, ay], [bx, by], [cx, cy]) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const hull = [];
  for (const point of points) {
    while (hull.length >= 2 && turn(hull.at(-2), hull.at(-1), point) <= 0) hull.pop();
    hull.push(point);
  }
  const lowerLength = hull.length;
  for (let i = points.length - 2; i >= 0; i--) {
    const point = points[i];
    while (hull.length > lowerLength && turn(hull.at(-2), hull.at(-1), point) <= 0) hull.pop();
    hull.push(point);
  }
  hull.pop();
  if (hull.length < 3) return null;

  let area = 0;
  let minY = Infinity, maxY = -Infinity;
  const edges = hull.map(([x, y], i) => {
    const [endX, endY] = hull[(i + 1) % hull.length];
    const dx = endX - x, dy = endY - y;
    const length = Math.hypot(dx, dy);
    area += x * endY - y * endX;
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    return { x, y, endX, endY, nx: dy / length, ny: -dx / length };
  });
  if (area < 8) return null;
  return { edges, minX: points[0][0], maxX: points.at(-1)[0], minY, maxY };
}

export function bounceOffHull(particle, hull, oldX, oldY, dt, contact) {
  const { x, y } = particle;
  if (Math.max(oldX, x) < hull.minX || Math.min(oldX, x) > hull.maxX ||
      Math.max(oldY, y) < hull.minY || Math.min(oldY, y) > hull.maxY) return false;

  let enter = 0, exit = 1;
  let entryEdge, nearestEdge;
  let nearestDistance = -Infinity;
  let startsInside = true;
  for (const edge of hull.edges) {
    const start = (oldX - edge.x) * edge.nx + (oldY - edge.y) * edge.ny;
    const end = (x - edge.x) * edge.nx + (y - edge.y) * edge.ny;
    if (start > 0) startsInside = false;
    if (end > nearestDistance) {
      nearestDistance = end;
      nearestEdge = edge;
    }
    if (start > 0 && end > 0) return false;
    if (start > 0) {
      const t = start / (start - end);
      if (t >= enter) { enter = t; entryEdge = edge; }
    } else if (end > 0) {
      exit = Math.min(exit, start / (start - end));
    }
    if (enter > exit) return false;
  }

  // A new tracking sample can engulf a particle. Let it leave freely if
  // already exiting, otherwise project it out across the nearest plane.
  if (startsInside && nearestDistance > 0) return false;
  const edge = startsInside ? nearestEdge : entryEdge;
  // A segment that touches only a vertex does not enter the face.
  if (!edge || (!startsInside && enter === exit && exit < 1)) return false;
  const { nx, ny } = edge;
  const hitX = startsInside ? x - nearestDistance * nx : oldX + (x - oldX) * enter;
  const hitY = startsInside ? y - nearestDistance * ny : oldY + (y - oldY) * enter;
  const normalSpeed = particle.vx * nx + particle.vy * ny;
  if (normalSpeed < 0) {
    // Preserve tangential velocity and retain 68% of inward normal speed.
    particle.vx -= 1.68 * normalSpeed * nx;
    particle.vy -= 1.68 * normalSpeed * ny;
    particle.tint = Math.min(1, particle.tint + .35);
  }
  const remaining = startsInside ? 0 : dt * (1 - enter);
  particle.x = hitX + nx * .75 + particle.vx * remaining;
  particle.y = hitY + ny * .75 + particle.vy * remaining;
  if (startsInside && particle.history) {
    for (let i = 0; i < particle.history.length; i += 2) {
      particle.history[i] = particle.x;
      particle.history[i + 1] = particle.y;
    }
  }
  contact?.(hitX, hitY, nx, ny);
  return true;
}
