"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatJalaliDate, toPersianDigits } from "@barat/ui";
import { BadgeCheck, Loader2, Star } from "lucide-react";
import { api, ApiClientError } from "@/lib/api";
import {
  REVIEW_BODY_MAX,
  REVIEWS_HASH,
  reviewStatusFa,
  type ListReviewsResponse,
  type MyReview,
  type PublicReview,
  type ReviewItemType,
} from "@/lib/reviews";
import { formatRating, Stars } from "./star-rating";

type Viewer = { readonly kind: "unknown" } | { readonly kind: "guest" } | { readonly kind: "customer"; readonly review: MyReview | null };

const STAR_WORDS = ["", "خیلی بد", "بد", "معمولی", "خوب", "عالی"] as const;

/**
 * The «دیدگاه کاربران» tab of a product page.
 *
 * What the public sees is only ever approved reviews and an approved-only
 * average, served by the API. A customer's own review is shown to them with
 * its moderation status, so a pending one never looks lost.
 */
export function ProductReviews({
  itemType,
  itemSlug,
  initial,
}: {
  readonly itemType: ReviewItemType;
  readonly itemSlug: string;
  readonly initial: ListReviewsResponse | null;
}) {
  const pathname = usePathname();
  const [data, setData] = useState<ListReviewsResponse | null>(initial);
  const [loadError, setLoadError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [viewer, setViewer] = useState<Viewer>({ kind: "unknown" });
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    let active = true;
    if (initial === null) {
      api.reviews(itemType, itemSlug)
        .then((result) => { if (active) setData(result); })
        .catch(() => { if (active) setLoadError(true); });
    }
    api.me()
      .then(async (me) => {
        if (!active) return;
        if (!me.isAuthenticated) {
          setViewer({ kind: "guest" });
          return;
        }
        const review = await api.myReview(itemType, itemSlug).catch(() => null);
        if (active) setViewer({ kind: "customer", review });
      })
      .catch(() => { if (active) setViewer({ kind: "guest" }); });
    return () => { active = false; };
  }, [initial, itemType, itemSlug]);

  const loadMore = useCallback(async () => {
    if (data === null || data.page >= data.totalPages) return;
    setLoadingMore(true);
    try {
      const next = await api.reviews(itemType, itemSlug, data.page + 1);
      setData({ ...next, items: [...data.items, ...next.items] });
    } catch {
      /* The button stays; the customer can simply try again. */
    } finally {
      setLoadingMore(false);
    }
  }, [data, itemType, itemSlug]);

  const loginHref = `/login?next=${encodeURIComponent(`${pathname}#${REVIEWS_HASH}`)}`;

  return (
    <div className="reviews">
      {data === null ? (
        <p className="muted">{loadError ? "دیدگاه‌ها در حال حاضر در دسترس نیست." : "در حال بارگذاری دیدگاه‌ها…"}</p>
      ) : (
        <ReviewSummaryBlock data={data} />
      )}

      <div className="reviews-write">
        {viewer.kind === "guest" ? (
          <Link className="btn btn-outline" href={loginHref as never}>
            برای ثبت دیدگاه وارد شوید
          </Link>
        ) : viewer.kind === "customer" ? (
          formOpen ? (
            <ReviewForm
              itemType={itemType}
              itemSlug={itemSlug}
              existing={viewer.review}
              onCancel={() => setFormOpen(false)}
              onSaved={(review) => {
                setViewer({ kind: "customer", review });
                setFormOpen(false);
              }}
            />
          ) : (
            <>
              {viewer.review !== null ? (
                <p className="reviews-mine" role="status">
                  <Stars value={viewer.review.rating} size={14} label={`امتیاز شما: ${toPersianDigits(viewer.review.rating)} از ۵`} />
                  <span>{reviewStatusFa(viewer.review.status)}</span>
                </p>
              ) : null}
              <button type="button" className="btn btn-outline" onClick={() => setFormOpen(true)}>
                {viewer.review === null ? "ثبت دیدگاه" : "ویرایش دیدگاه من"}
              </button>
            </>
          )
        ) : null}
      </div>

      {data !== null && data.items.length > 0 ? (
        <ul className="reviews-list">
          {data.items.map((review) => (
            <ReviewItem key={review.id} review={review} />
          ))}
        </ul>
      ) : null}

      {data !== null && data.page < data.totalPages ? (
        <button type="button" className="btn btn-ghost reviews-more" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? "در حال بارگذاری…" : "نمایش دیدگاه‌های بیشتر"}
        </button>
      ) : null}
    </div>
  );
}

function ReviewSummaryBlock({ data }: { readonly data: ListReviewsResponse }) {
  const { summary } = data;
  if (summary.average === null || summary.count === 0) {
    return <p className="muted reviews-empty">هنوز دیدگاهی برای این محصول منتشر نشده است. اولین نفر باشید.</p>;
  }
  const average = formatRating(summary.average);
  return (
    <div className="reviews-summary">
      <div className="reviews-score">
        <strong>{average}</strong>
        <span className="muted">از ۵</span>
        <Stars value={summary.average} size={18} label={`امتیاز ${average} از ۵`} />
        <span className="muted">{toPersianDigits(summary.count)} دیدگاه</span>
      </div>
      <ul className="reviews-bars" aria-label="تعداد دیدگاه به تفکیک امتیاز">
        {[5, 4, 3, 2, 1].map((stars) => {
          const count = summary.distribution[stars - 1] ?? 0;
          const percent = summary.count === 0 ? 0 : Math.round((count / summary.count) * 100);
          return (
            <li key={stars}>
              <span className="reviews-bar-label">
                {toPersianDigits(stars)} <Star size={12} aria-hidden="true" fill="currentColor" strokeWidth={0} />
              </span>
              <span className="reviews-bar-track" aria-hidden="true">
                <span className="reviews-bar-fill" style={{ width: `${percent}%` }} />
              </span>
              <span className="reviews-bar-count">{toPersianDigits(count)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ReviewItem({ review }: { readonly review: PublicReview }) {
  return (
    <li className="review">
      <div className="review-head">
        <strong>{review.authorNameFa}</strong>
        {review.isVerifiedBuyer ? (
          <span className="review-buyer">
            <BadgeCheck size={13} aria-hidden="true" /> خریدار
          </span>
        ) : null}
        <span className="muted review-date">{formatJalaliDate(review.createdAt, "d MMMM yyyy")}</span>
      </div>
      <Stars value={review.rating} size={14} label={`${toPersianDigits(review.rating)} از ۵`} />
      {review.body !== null ? <p className="review-body">{review.body}</p> : null}
    </li>
  );
}

function ReviewForm({
  itemType,
  itemSlug,
  existing,
  onCancel,
  onSaved,
}: {
  readonly itemType: ReviewItemType;
  readonly itemSlug: string;
  readonly existing: MyReview | null;
  readonly onCancel: () => void;
  readonly onSaved: (review: MyReview) => void;
}) {
  const groupName = useId();
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [body, setBody] = useState(existing?.body ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (rating < 1) {
      setError("یک امتیاز از ۱ تا ۵ ستاره انتخاب کنید.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const trimmed = body.trim();
      onSaved(await api.submitReview({ itemType, itemSlug, rating, body: trimmed === "" ? null : trimmed }));
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "ثبت دیدگاه ممکن نشد. دوباره تلاش کنید.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="review-form card pad" onSubmit={submit} noValidate>
      <fieldset className="review-stars-input">
        <legend>امتیاز شما</legend>
        {/* Native radios underneath the stars: arrow keys, focus and the
            selected value all come from the browser, not from click handlers. */}
        {[1, 2, 3, 4, 5].map((value) => (
          <label key={value} className={value <= rating ? "on" : undefined}>
            <input
              type="radio"
              name={groupName}
              value={value}
              checked={rating === value}
              onChange={() => setRating(value)}
            />
            <Star size={26} aria-hidden="true" fill={value <= rating ? "currentColor" : "none"} strokeWidth={value <= rating ? 0 : 1.6} />
            <span className="sr-only">{`${toPersianDigits(value)} ستاره — ${STAR_WORDS[value]}`}</span>
          </label>
        ))}
        <span className="review-stars-word" aria-hidden="true">{rating > 0 ? STAR_WORDS[rating] : ""}</span>
      </fieldset>

      <label className="review-body-input">
        <span>متن دیدگاه (اختیاری)</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={REVIEW_BODY_MAX}
          rows={4}
          placeholder="تجربهٔ خرید و تحویل را برای دیگران بنویسید."
        />
        <span className="muted review-counter">{toPersianDigits(body.length)} / {toPersianDigits(REVIEW_BODY_MAX)}</span>
      </label>

      <p className="muted review-note">دیدگاه پس از بررسی و تأیید نمایش داده می‌شود. اطلاعات تماس یا کد کارت را در متن ننویسید.</p>
      {error !== null ? <p className="alert warn" role="alert">{error}</p> : null}

      <div className="review-actions">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? <><Loader2 className="animate-spin" size={16} aria-hidden="true" /> در حال ارسال…</> : "ارسال دیدگاه"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={submitting}>انصراف</button>
      </div>
    </form>
  );
}
