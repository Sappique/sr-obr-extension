export interface TopMemory {
  y: number;
  h: number;
}

/**
 * A resize from a top handle keeps the bottom edge fixed and moves the top.
 * Height comes from the content, so put the top back where it was.
 */
export function stableTop(y: number, h: number, last: TopMemory | undefined): number {
  if (!last || Math.abs(h - last.h) <= 0.5) return y;
  return Math.abs(y + h - (last.y + last.h)) < 1 ? last.y : y;
}

export interface FrameGeometry {
  position: { x: number; y: number };
  scale: { x: number; y: number };
  points: { x: number; y: number }[];
}

/**
 * The frame's real rectangle in the scene, however a resize was stored: as a
 * scale, a moved position, or outline points that no longer start at zero.
 */
export function frameBounds(frame: FrameGeometry) {
  const xs = frame.points.map((p) => frame.position.x + p.x * frame.scale.x);
  const ys = frame.points.map((p) => frame.position.y + p.y * frame.scale.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export interface SceneWrites {
  frames: () => Promise<void>;
  place: () => Promise<void>;
  add: () => Promise<void>;
  remove: () => Promise<void>;
}

/**
 * The frame goes first: OBR carries attached parts along when a frame's
 * position is written, so parts placed earlier would get the shift twice.
 * Placing them afterwards makes their absolute positions final.
 */
export async function applyWrites(writes: SceneWrites) {
  await writes.frames();
  await writes.place();
  await writes.add();
  await writes.remove();
}
