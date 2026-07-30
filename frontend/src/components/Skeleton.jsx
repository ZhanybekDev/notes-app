/**
 * A single placeholder block. Width and height come from the caller, because a skeleton is only
 * useful when it has the shape of the thing that is loading.
 *
 * `aria-hidden` throughout: the loading state is announced by the live region that owns the request,
 * not by a screen reader reading out three grey rectangles.
 */
export default function Skeleton({ width = '100%', height = 'var(--space-4)', className = '' }) {
  return (
    <span
      className={`skeleton ${className}`.trim()}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

/** The notes list while it loads: three rows, each a title over a shorter meta line. */
export function SkeletonList({ rows = 3 }) {
  return (
    <div className="skeleton-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row">
          <Skeleton width="70%" />
          <Skeleton width="40%" height="var(--space-3)" />
        </div>
      ))}
    </div>
  );
}
