import { Accordion } from "@barat/ui";

const items = [
  { value: "q1", title: "چقدر طول می‌کشد تا گیفت‌کارت به دستم برسد؟", content: "بیشتر سفارش‌ها در همان روز و اغلب طی چند دقیقه تا چند ساعت پس از تأیید پرداخت آماده می‌شود." },
  { value: "q2", title: "قیمت نهایی چگونه تعیین می‌شود؟", content: "قیمت بر اساس نرخ لحظه‌ای ارز به‌علاوه کارمزد شفاف محاسبه و پیش از پرداخت به شما نمایش داده می‌شود." },
  { value: "q3", title: "اگر پرداختم ناموفق بود چه کار کنم؟", content: "در صورت کسر وجه و عدم تأیید سفارش، مبلغ به‌طور خودکار بازگردانده می‌شود یا سفارش شما به بررسی دستی ارجاع می‌شود." },
  { value: "q4", title: "چطور با پشتیبانی تماس بگیرم؟", content: "از بخش «حساب کاربری > پشتیبانی» پیام خود را ثبت کنید تا تیم ما در اسرع وقت پاسخ دهد." },
];

export default function HelpPage() {
  return (
    <main className="page container" style={{ maxWidth: 700 }}>
      <div className="eyebrow">راهنما</div>
      <h1 className="h2">سوالات متداول</h1>
      <p className="muted">پاسخ سوالات رایج درباره خرید، پرداخت و پیگیری سفارش.</p>
      <div style={{ marginTop: 18 }}>
        <Accordion items={items} />
      </div>
    </main>
  );
}
