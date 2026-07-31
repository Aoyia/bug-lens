export type ClipRange = {
  startTime: number;
  endTime: number;
};

export function calculateClipRange(
  nodeTimestamp: number,
  startedAtEpochMs: number,
  durationSec: number,
  windowRadiusSec = 2.5
): ClipRange {
  if (durationSec <= 0 || !Number.isFinite(durationSec)) {
    return { startTime: 0, endTime: 0 };
  }

  const nodeOffsetSec = Math.max(0, (nodeTimestamp - startedAtEpochMs) / 1000);
  const targetWindowLength = windowRadiusSec * 2;

  let startTime = Math.max(0, nodeOffsetSec - windowRadiusSec);
  let endTime = Math.min(durationSec, startTime + targetWindowLength);

  if (endTime - startTime < targetWindowLength && durationSec >= targetWindowLength) {
    startTime = Math.max(0, endTime - targetWindowLength);
  }

  return {
    startTime: Number(startTime.toFixed(3)),
    endTime: Number(endTime.toFixed(3))
  };
}
