/** Greedy interval-packing helpers used by all three calendar views to lay
 *  out overlapping chips. Intervals are [start, end) — units are caller's
 *  choice (column index for Month/Week spanning, milliseconds for Day).
 *
 *  Two flavors:
 *  - `assignLanes` — single shared denominator across the whole row. Used in
 *    Month/Week where every chip in a row is the same height.
 *  - `clusterLanes` — denominator scoped to each overlap cluster. Used in
 *    Day so an isolated 9am event renders full-height even when 4pm has 3
 *    overlapping shifts. Matches Outlook / Teams behavior. */

export interface Interval {
  start: number;
  end: number;
}

export interface LaneAssignment<T> {
  /** lane index 0..laneCount-1 for each input */
  lanes: Map<T, number>;
  /** total number of lanes used (equal stride across the row) */
  laneCount: number;
}

export function assignLanes<T extends Interval>(items: T[]): LaneAssignment<T> {
  const sorted = [...items].sort(
    (a, b) => a.start - b.start || b.end - a.end,
  );
  const laneEnds: number[] = [];
  const lanes = new Map<T, number>();
  for (const item of sorted) {
    let placed = false;
    for (let i = 0; i < laneEnds.length; i++) {
      if (laneEnds[i] <= item.start) {
        laneEnds[i] = item.end;
        lanes.set(item, i);
        placed = true;
        break;
      }
    }
    if (!placed) {
      laneEnds.push(item.end);
      lanes.set(item, laneEnds.length - 1);
    }
  }
  return { lanes, laneCount: laneEnds.length };
}

export interface ClusterAssignment<T> {
  /** lane index within the item's cluster */
  lanes: Map<T, number>;
  /** total lanes in the item's cluster — divides the row width */
  denominators: Map<T, number>;
}

export function clusterLanes<T extends Interval>(
  items: T[],
): ClusterAssignment<T> {
  const sorted = [...items].sort(
    (a, b) => a.start - b.start || b.end - a.end,
  );
  const lanes = new Map<T, number>();
  const denominators = new Map<T, number>();
  let cluster: T[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    for (const it of cluster) {
      let placed = false;
      for (let i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i] <= it.start) {
          laneEnds[i] = it.end;
          lanes.set(it, i);
          placed = true;
          break;
        }
      }
      if (!placed) {
        laneEnds.push(it.end);
        lanes.set(it, laneEnds.length - 1);
      }
    }
    const denom = laneEnds.length;
    for (const it of cluster) denominators.set(it, denom);
    cluster = [];
  };
  for (const item of sorted) {
    if (item.start < clusterEnd) {
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.end);
    } else {
      flush();
      cluster = [item];
      clusterEnd = item.end;
    }
  }
  flush();
  return { lanes, denominators };
}
