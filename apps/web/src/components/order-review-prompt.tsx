import Link from "next/link";
import { toPersianDigits } from "@barat/ui";
import { MessageSquareText } from "lucide-react";
import { REVIEWS_HASH, reviewStatusFa, type OrderReviewTarget } from "@/lib/reviews";
import { Stars } from "./star-rating";

/**
 * Under a delivered order: invite a rating of what was bought, or, once rated,
 * say where the review stands and offer to edit it. Links to the product page's
 * reviews tab, which is the one place reviews are written.
 */
export function OrderReviewPrompt({ target }: { readonly target: OrderReviewTarget }) {
  const href = `${target.href}#${REVIEWS_HASH}`;
  const mine = target.myReview;
  return (
    <div className="card pad order-review-prompt">
      <MessageSquareText size={22} aria-hidden="true" />
      <div>
        {mine === null ? (
          <>
            <strong>به این محصول امتیاز دهید</strong>
            <p className="muted">تجربهٔ شما از خرید {target.titleFa} به خریداران بعدی کمک می‌کند.</p>
          </>
        ) : (
          <>
            <strong className="order-review-mine">
              امتیاز شما به {target.titleFa}
              <Stars value={mine.rating} size={14} label={`${toPersianDigits(mine.rating)} از ۵`} />
            </strong>
            <p className="muted">{reviewStatusFa(mine.status)}</p>
          </>
        )}
      </div>
      <Link className="btn btn-outline" href={href as never}>
        {mine === null ? "ثبت امتیاز و دیدگاه" : "ویرایش دیدگاه"}
      </Link>
    </div>
  );
}
