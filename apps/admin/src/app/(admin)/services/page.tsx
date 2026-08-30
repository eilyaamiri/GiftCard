export const metadata = { title: "سرویس‌های بین‌المللی | پنل ادمین برات پی" };

const services = [
  { name: "ChatGPT Plus", category: "AI Tools", fields: ["ایمیل حساب", "توضیح سفارش"] },
  { name: "Netflix اشتراک", category: "SaaS", fields: ["ایمیل حساب", "پلن"] },
  { name: "Cloudflare / AWS", category: "Cloud", fields: ["شناسه حساب", "مبلغ شارژ"] },
  { name: "ثبت دامنه / هاست", category: "Domain/Hosting", fields: ["نام دامنه", "مدت"] },
  { name: "دورهٔ آموزشی آنلاین", category: "Education", fields: ["لینک دوره", "ایمیل حساب"] },
  { name: "هزینهٔ آزمون بین‌المللی", category: "Exam Fee", fields: ["کد داوطلب", "تاریخ آزمون"] },
];

export default function ServicesPage() {
  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">کاتالوگ و تأمین</p>
          <h1>سرویس‌های بین‌المللی</h1>
        </div>
        <p className="muted">فیلدهای فرم هر سرویس بک‌اند‌محور و پیکربندی‌پذیرند</p>
      </div>

      <div className="task-grid">
        {services.map((service) => (
          <div className="card task-panel" key={service.name}>
            <div className="panel-heading">
              <h2 className="panel-title">{service.name}</h2>
              <span className="tag-pill">{service.category}</span>
            </div>
            <p className="panel-caption" style={{ marginBottom: 10 }}>فیلدهای فرم سفارش:</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {service.fields.map((field) => (
                <span key={field} className="tag-pill">{field}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
