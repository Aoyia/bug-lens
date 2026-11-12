import { memo } from "preact/compat";

export interface FrameBadgeProps {
  frameId?: string | number;
  frameUrl?: string;
  classNamePrefix: "console" | "network" | "framework";
}

export const FrameBadge = memo(function FrameBadge({
  frameId,
  frameUrl,
  classNamePrefix,
}: FrameBadgeProps) {
  const isSubframe = Boolean(frameId);
  const label = isSubframe ? `Frame [${frameId}]` : "Top Frame";
  const title = isSubframe
    ? frameUrl
      ? `${frameUrl} (${label})`
      : label
    : "Top Frame";

  return (
    <span
      className={`${classNamePrefix}-frame-badge ${isSubframe ? "badge-subframe" : "badge-topframe"}`}
      title={title}
    >
      {label}
    </span>
  );
});
