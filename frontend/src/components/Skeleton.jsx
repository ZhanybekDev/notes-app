/**
 * A placeholder block. Its shape comes from a class, not from props: an inline width would be the
 * one size in the app that does not go through the stylesheet, and a skeleton is only useful when it
 * has the proportions of the thing it stands in for.
 *
 * `aria-hidden` throughout: the loading state is announced by the live region that owns the request,
 * not by a screen reader reading out grey rectangles.
 */
export default function Skeleton({ className = '' }) {
  return <span className={`skeleton ${className}`.trim()} aria-hidden="true" />;
}

/** The notes list while it loads: three rows, each a title over a shorter meta line. */
export function SkeletonList({ rows = 3 }) {
  return (
    <div className="skeleton-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row">
          <Skeleton className="skeleton-title" />
          <Skeleton className="skeleton-meta" />
        </div>
      ))}
    </div>
  );
}
