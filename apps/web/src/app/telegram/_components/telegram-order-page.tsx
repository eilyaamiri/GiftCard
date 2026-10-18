import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  type TelegramCatalogEntry,
  type TelegramProduct,
  type TopUpOffer,
  offerLabel,
  offerQuantity,
} from "@/lib/telegram";
import { api } from "@/lib/api";
import { productTabs } from "@/components/product-description";
import { ProductInfoTabs } from "@/components/product-info-tabs";
import { RatingBadge } from "@/components/star-rating";
import { TelegramOrderForm } from "./telegram-order-form";

/**
 * The frame both Telegram order pages share.
 *
 * It exists so that «این محصول موجود نیست» is written once and reads the same
 * whether the catalogue is empty, the supplier is switched off, or the entry
 * simply has nothing currently available — states that are indistinguishable
 * from the storefront's side and should not be dressed up as different ones.
 */

const COPY: Record<TelegramProduct, { readonly title: string; readonly lead: string; readonly unit: string }> = {
  stars: {
    title: "خرید استارز تلگرام",
    lead: "بستهٔ مورد نظر را انتخاب کنید و نام کاربری تلگرام‌تان را وارد کنید تا قیمت نهایی را ببینید.",
    unit: "استارز",
  },
  premium: {
    title: "خرید پرمیوم تلگرام",
    lead: "دورهٔ پرمیوم را انتخاب کنید و نام کاربری تلگرام‌تان را وارد کنید تا قیمت نهایی را ببینید.",
    unit: "ماه",
  },
};

/** The label an offer carries in the picker, always a real catalogue name. */
function choice(entry: TelegramCatalogEntry, offer: TopUpOffer): { readonly id: string; readonly label: string; readonly hint: string | null } {
  const quantity = offerQuantity(offer);
  return {
    id: offer.id,
    label: offerLabel(entry.product, offer, quantity),
    /* The supplier's own name, shown only when our label paraphrased it, so the
     * customer can still recognise the item they saw elsewhere. */
    hint: quantity === null ? null : offer.name,
  };
}

export async function TelegramOrderPage({
  entry,
  product,
}: Readonly<{ entry: TelegramCatalogEntry | null; product: TelegramProduct }>) {
  const copy = COPY[product];

  if (entry === null) {
    return (
      <main className="page container tg-order-page">
        <nav className="tg-breadcrumb" aria-label="مسیر صفحه">
          <Link href="/telegram">تلگرام</Link>
          <span aria-hidden="true">/</span>
          <span>{copy.title}</span>
        </nav>
        <div className="card pad tg-unavailable">
          <div className="eyebrow">در دسترس نیست</div>
          <h1 className="h2">{copy.title}</h1>
          <p className="muted">
            این محصول همین حالا قابل سفارش نیست. ممکن است موجودی یا اتصال به تأمین‌کننده قطع باشد؛
            چیزی از شما کسر نشده است.
          </p>
          <div className="tg-unavailable-actions">
            <Link className="btn btn-outline" href="/telegram">بازگشت به صفحهٔ تلگرام</Link>
            <Link className="btn btn-ghost" href="/help">تماس با پشتیبانی</Link>
          </div>
        </div>
      </main>
    );
  }

  /* Fetched together; a failure costs only the tabs, never the order form. */
  const [reviews, faqs] = await Promise.all([
    api.reviews("TOPUP_GAME", entry.game.slug).catch(() => null),
    api.faqs("TOPUP_GAME", entry.game.slug).catch(() => null),
  ]);
  const infoTabs = productTabs({
    description: null,
    guide: entry.game.providerNote,
    reviews: { itemType: "TOPUP_GAME", itemSlug: entry.game.slug, initial: reviews },
    faqs: { itemType: "TOPUP_GAME", itemSlug: entry.game.slug, initial: faqs },
  });

  return (
    <main className="page container tg-order-page">
      <nav className="tg-breadcrumb" aria-label="مسیر صفحه">
        <Link href="/telegram">تلگرام</Link>
        <span aria-hidden="true">/</span>
        <span>{copy.title}</span>
      </nav>

      <header className="tg-order-head">
        <img
          className="tg-order-art"
          src={product === "stars" ? "/telegram-stars.png" : "/telegram-premium.png"}
          alt=""
          width={64}
          height={64}
          aria-hidden="true"
        />
        <div>
          <h1 className="h2">{entry.game.nameFa ?? copy.title}</h1>
          <RatingBadge summary={reviews?.summary ?? null} />
          <p className="muted">{entry.game.descriptionFa ?? copy.lead}</p>
        </div>
      </header>

      <TelegramOrderForm
        product={product}
        offerId={entry.game.id}
        offers={entry.offers.map((offer) => choice(entry, offer))}
        fields={(entry.game.fields ?? []).map((field) => ({
          key: field.key,
          label: field.labelFa ?? field.label,
          isRequired: field.isRequired,
          options: field.options ?? null,
          validationRegex: field.validationRegex ?? null,
          helpTextFa: field.helpTextFa ?? null,
        }))}
      />

      <p className="tg-order-foot">
        {/* Says what is happening rather than what we hope: the supplier is the
            one that decides, and the customer is told before paying. */}
        <ArrowRight size={14} aria-hidden="true" /> تحویل پس از تأیید پرداخت و پاسخ تأمین‌کننده انجام می‌شود؛
        اگر خرید انجام نشود، پشتیبانی وضعیت سفارش و بازگشت وجه را پیگیری می‌کند.
      </p>

      <ProductInfoTabs title={`دربارهٔ ${entry.game.nameFa ?? copy.title}`} tabs={infoTabs} />
    </main>
  );
}
