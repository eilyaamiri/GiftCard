/**
 * The questions a visitor actually asks before their first order.
 *
 * One list, read by both the landing page's closing section and `/help`, so the
 * two can never answer the same question differently — which is the failure
 * mode a second hand-maintained copy always eventually reaches.
 *
 * Kept short on purpose. An answer that needs three paragraphs is not an FAQ
 * entry; it is a page, and it belongs behind a link.
 */
export type FaqEntry = {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
};

export const FAQ_ENTRIES: readonly FaqEntry[] = [
  {
    id: "delivery",
    question: "بعد از پرداخت، گیفت‌کارت چه زمانی به دستم می‌رسد؟",
    answer:
      "بیشتر سفارش‌ها چند دقیقه پس از تأیید پرداخت آماده می‌شوند و کد را در پنل کاربری‌تان می‌بینید. اگر سفارشی به بررسی دستی نیاز داشته باشد، وضعیتش در همان صفحه مشخص است و بی‌خبر نمی‌مانید.",
  },
  {
    id: "pricing",
    question: "قیمت نهایی چطور محاسبه می‌شود؟",
    answer:
      "قیمت از نرخ لحظه‌ای ارز به‌علاوهٔ کارمزد مشخص ساخته می‌شود و پیش از پرداخت، کامل و بدون هزینهٔ پنهان به شما نشان داده می‌شود. تا وقتی تأیید نکنید، هیچ مبلغی قطعی نیست.",
  },
  {
    id: "failed-payment",
    question: "اگر پرداختم ناموفق شد ولی مبلغ کسر شده بود چه کنم؟",
    answer:
      "اگر وجه کسر شود و سفارش تأیید نشود، مبلغ به‌صورت خودکار به حسابتان برمی‌گردد. در مواردی که برگشت خودکار انجام نشود، سفارش برای بررسی دستی ثبت می‌شود و می‌توانید آن را از پنل کاربری پیگیری کنید.",
  },
  {
    id: "region",
    question: "کارت را برای کدام کشور انتخاب کنم؟",
    answer:
      "هر گیفت‌کارت فقط در منطقهٔ خودش فعال می‌شود و منطقهٔ هر کارت روی همان کارت نوشته شده است. اگر مطمئن نیستید حساب مقصدتان به کدام کشور تعلق دارد، پیش از خرید از پشتیبانی بپرسید.",
  },
  {
    id: "invalid-code",
    question: "اگر کد فعال نشد چه اتفاقی می‌افتد؟",
    answer:
      "کدی که فعال نشود جایگزین می‌شود یا مبلغش بازمی‌گردد. کافی است از پنل کاربری برای همان سفارش تیکت بزنید تا بررسی شود.",
  },
  {
    id: "services",
    question: "هزینهٔ سرویس‌های بین‌المللی را هم می‌توانم از اینجا پرداخت کنم؟",
    answer:
      "بله. برای فضای ابری، دامنه و هاستینگ، ابزارهای هوش مصنوعی، دوره‌های آموزشی و اشتراک‌های نرم‌افزاری درخواست پرداخت ثبت کنید؛ بقیهٔ کار با ماست.",
  },
];
