export type PositionSelection =
  | { kind: 'pool'; poolId: string }
  | { kind: 'lockup'; lockupId: string };

export function sameSelection(a: PositionSelection, b: PositionSelection) {
  if (a.kind === 'pool' && b.kind === 'pool') return a.poolId === b.poolId;
  if (a.kind === 'lockup' && b.kind === 'lockup') return a.lockupId === b.lockupId;
  return false;
}
