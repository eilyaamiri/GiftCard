import Link from "next/link";
import { formatJalaliDate, toPersianDigits } from "@barat/ui";
import { requireRole } from "@/lib/session";
import {
  REVIEW_ITEM_TYPE_LABEL,
  REVIEW_MODERATION_ROLES,
  REVIEW_STATUS_LABEL,
  REVIEW_STATUSES,
  isReviewStatus,
  reviewModeration,
  type AdminReview,
  type ReviewStatus,
} from "@/lib/reviews";
import { ErrorNotice } from "../../(operator)/_components/error-notice";
import { ReviewDecision } from "./review-decision";

export const metadata = { title: "بررسی دیدگاه‌ها | پنل ادمین سنتو" };

/**
 * Where a review's product lives on the storefront, which is a different host
 * from this panel. Read on the server at request time, so `STOREFRONT_URL` can
 * point a staging panel at a staging site without a rebuild.
 */
const STOREFRONT_URL = (process.env["STOREFRONT_URL"] ?? "https://www.centohub.com").replace(/\/+$/u, "");

const EMPTY_HINT: Record<ReviewStatus, string> = {
  PENDING: "دیدگاهی در انتظار بررسی نیست.",
  APPROVED: "هنوز دیدگاهی منتشر نشده است.",
  REJECTED: "دیدگاه ردشده‌ای وجود ندارد.",
};

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole(REVIEW_MODERATION_ROLES);
  const query = await searchParams;
  const requested = single(query.status);
  const status: ReviewStatus = isReviewStatus(requested) ? requested : "PENDING";
  const pageNumber = Number(single(query.page) ?? "1");
  const page = Number.isSafeInteger(pageNumber) && pageNumber >= 1 ? pageNumber : 1;

  try {
    const data = await reviewModeration.list(status, page);
    return (
      <div>
        <div className="page-heading">
          <div>
            <p className="eyebrow">عملیات و بازرسی</p>
            <h1>بررسی دیدگاه‌ها</h1>
          </div>
          <p className="muted">
            دیدگاه مشتری تا تأیید شما روی سایت نمایش داده نمی‌شود و در میانگین امتیاز هم حساب نمی‌شود. اگر مشتری دیدگاهش
            را ویرایش کند، دوباره به این صف برمی‌گردد.
          </p>
        </div>

        <nav className="report-filter-tabs" aria-label="وضعیت دیدگاه‌ها">
          {REVIEW_STATUSES.map((key) => (
            <Link key={key} href={`/reviews?status=${key}`} className={status === key ? "active" : ""} aria-current={status === key ? "page" : undefined}>
              {REVIEW_STATUS_LABEL[key]} ({toPersianDigits(data.counts[key])})
            </Link>
          ))}
        </nav>

        <div className="card list-card report-section">
          <div className="panel-heading">
            <h2 className="panel-title">{REVIEW_STATUS_LABEL[status]}</h2>
            <span className="panel-caption">{toPersianDigits(data.counts[status])} دیدگاه</span>
          </div>
          {data.items.length === 0 ? (
            <p className="empty-hint">{EMPTY_HINT[status]}</p>
          ) : (
            <ul className="review-queue">
              {data.items.map((review) => (
                <ReviewRow key={review.id} review={review} />
              ))}
            </ul>
          )}
          {data.totalPages > 1 ? (
            <nav className="review-queue-pages" aria-label="صفحه‌ها">
              {page > 1 ? <Link href={`/reviews?status=${status}&page=${page - 1}`}>صفحهٔ قبل</Link> : <span />}
              <span className="muted">
                صفحهٔ {toPersianDigits(page)} از {toPersianDigits(data.totalPages)}
              </span>
              {page < data.totalPages ? <Link href={`/reviews?status=${status}&page=${page + 1}`}>صفحهٔ بعد</Link> : <span />}
            </nav>
          ) : null}
        </div>
      </div>
    );
  } catch (error) {
    return <ErrorNotice error={error} title="دیدگاه‌ها بارگذاری نشد" />;
  }
}

function ReviewRow({ review }: { readonly review: AdminReview }) {
  const stars = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
  return (
    <li className="review-queue-item">
      <div className="review-queue-head">
        <span className="review-queue-product">
          {review.target === null ? (
            <span className="muted">محصول حذف‌شده</span>
          ) : (
            <>
              <span className="muted">{REVIEW_ITEM_TYPE_LABEL[review.target.itemType]} · </span>
              {/* Opens the product page with its reviews tab, so the moderator
                * can read the review in the context it will appear in. */}
              <a href={`${STOREFRONT_URL}${review.target.href}#reviews`} target="_blank" rel="noopener noreferrer">
                <strong>{review.target.titleFa}</strong>
              </a>
            </>
          )}
        </span>
        <span className="review-queue-stars" role="img" aria-label={`${toPersianDigits(review.rating)} از ۵ ستاره`}>
          {stars}
        </span>
      </div>

      {review.body === null ? (
        <p className="review-queue-body muted">بدون متن — فقط امتیاز.</p>
      ) : (
        <p className="review-queue-body">{review.body}</p>
      )}

      <div className="review-queue-meta">
        <span>
          نمایش روی سایت به نام <strong>{review.authorNameFa}</strong>
        </span>
        <span className="bp-ltr">{review.customerCode}</span>
        {review.isVerifiedBuyer ? <span className="badge badge-success">خریدار</span> : <span className="badge badge-info">بدون خرید</span>}
        <span>آخرین ویرایش: {formatJalaliDate(review.updatedAt)}</span>
        {review.moderatedAt !== null ? (
          <span>
            تصمیم: {review.moderatedByName ?? "—"} · {formatJalaliDate(review.moderatedAt)}
          </span>
        ) : null}
      </div>

      <ReviewDecision id={review.id} status={review.status} updatedAt={review.updatedAt} />
    </li>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
