import { toPersianDigits } from "@barat/ui";
import { Star } from "lucide-react";
import { REVIEWS_HASH, type ReviewSummary } from "@/lib/reviews";

/** «۴٫۷» — one decimal, Persian digits and the Persian decimal separator. */
export function formatRating(value: number): string {
  return toPersianDigits(value.toFixed(1)).replace(".", "٫");
}

/**
 * Five stars filled to `value`, fractions included (4.7 fills 94%).
 *
 * Purely visual: the number is always stated in text next to it or in the
 * label, because a row of icons alone tells a screen reader nothing.
 */
export function Stars({ value, size = 16, label }: { readonly value: number; readonly size?: number; readonly label?: string }) {
  const percent = Math.max(0, Math.min(100, (value / 5) * 100));
  const row = (filled: boolean) =>
    Array.from({ length: 5 }, (_, index) => (
      <Star key={index} size={size} aria-hidden="true" fill={filled ? "currentColor" : "none"} strokeWidth={filled ? 0 : 1.6} />
    ));
  return (
    <span
      className="stars"
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
    >
      <span className="stars-track">{row(false)}</span>
      <span className="stars-fill" style={{ width: `${percent}%` }}>
        {row(true)}
      </span>
    </span>
  );
}

/**
 * The compact rating under a product's title, linking to its reviews tab.
 * Shows nothing until there is at least one approved review — an empty row of
 * stars reads as «rated zero», which is not the same as «not rated yet».
 */
export function RatingBadge({ summary }: { readonly summary: ReviewSummary | null }) {
  if (summary === null || summary.average === null || summary.count === 0) return null;
  const average = formatRating(summary.average);
  return (
    <a className="rating-badge" href={`#${REVIEWS_HASH}`}>
      <Stars value={summary.average} label={`امتیاز ${average} از ۵`} />
      <strong>{average}</strong>
      <span>({toPersianDigits(summary.count)} دیدگاه)</span>
    </a>
  );
}
