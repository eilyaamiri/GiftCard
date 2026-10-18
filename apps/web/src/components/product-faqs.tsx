"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import { FAQS_HASH, type FaqItemType, type ProductFaq } from "@/lib/faqs";

/**
 * The «سوالات متداول» tab of a product page.
 *
 * Displayed as an accordion: one question at a time. Empty when the product
 * has no enabled FAQs.
 */
export function ProductFaqs({
  itemType,
  itemSlug,
  initial,
}: {
  readonly itemType: FaqItemType;
  readonly itemSlug: string;
  readonly initial: readonly ProductFaq[] | null;
}) {
  const [items, setItems] = useState<readonly ProductFaq[] | null>(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (initial === null) {
      api.faqs(itemType, itemSlug)
        .then((result) => setItems(result))
        .catch(() => setLoadError(true));
    }
  }, [initial, itemType, itemSlug]);

  if (loadError) {
    return (
      <div className="reviews">
        <span id={FAQS_HASH} className="tab-anchor" />
        <p className="reviews-error">خطا در بارگذاری سوالات متداول. صفحه را تازه کنید.</p>
      </div>
    );
  }

  if (items === null) {
    return (
      <div className="reviews">
        <span id={FAQS_HASH} className="tab-anchor" />
        <p className="reviews-loading">در حال بارگذاری…</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="reviews">
        <span id={FAQS_HASH} className="tab-anchor" />
        <p className="reviews-empty">سوال متداولی برای این محصول ثبت نشده است.</p>
      </div>
    );
  }

  return (
    <div className="faqs">
      <span id={FAQS_HASH} className="tab-anchor" />
      <ul className="faq-list">
        {items.map((faq) => (
          <li key={faq.id} className="faq-item">
            <button
              type="button"
              className={`faq-question ${open === faq.id ? "open" : ""}`}
              onClick={() => setOpen(open === faq.id ? null : faq.id)}
              aria-expanded={open === faq.id}
            >
              <span>{faq.question}</span>
              <ChevronDown className="faq-chevron" size={18} />
            </button>
            {open === faq.id ? (
              <div className="faq-answer">{faq.answer}</div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
