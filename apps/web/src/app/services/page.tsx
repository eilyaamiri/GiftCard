import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Ltr } from "@barat/ui";

const services = [
  { slug: "openai", name: "OpenAI / ChatGPT Plus", category: "ابزار هوش مصنوعی", currency: "USD" },
  { slug: "google-cloud", name: "Google Cloud", category: "زیرساخت ابری", currency: "USD" },
  { slug: "namecheap", name: "دامنه و هاستینگ Namecheap", category: "دامنه و هاستینگ", currency: "USD" },
  { slug: "coursera", name: "دوره‌های Coursera", category: "آموزش", currency: "USD" },
  { slug: "toefl", name: "هزینه آزمون TOEFL", category: "هزینه آزمون", currency: "USD" },
  { slug: "figma", name: "اشتراک Figma", category: "SaaS", currency: "USD" },
];

export default function ServicesPage() {
  return (
    <main className="page container">
      <div className="eyebrow">پرداخت بین‌المللی</div>
      <h1 className="h2">پرداخت هزینه سرویس‌های خارجی</h1>
      <p className="muted">هزینه اشتراک‌ها، ابزارهای هوش مصنوعی، دامنه و هاستینگ، دوره‌های آموزشی و آزمون‌های بین‌المللی را با ریال بپردازید.</p>

      <div className="grid catalog-grid" style={{ marginTop: 22 }}>
        {services.map((service) => (
          <Link key={service.slug} href={`/services/${service.slug}`} className="card pad" style={{ display: "block" }}>
            <span className="chip" style={{ pointerEvents: "none", marginBottom: 12, display: "inline-block" }}>{service.category}</span>
            <h3 style={{ margin: "4px 0 6px" }}>{service.name}</h3>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>ارز پایه: <Ltr>{service.currency}</Ltr></p>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12, color: "var(--teal)", fontWeight: 700, fontSize: 13 }}>
              درخواست پرداخت <ArrowLeft size={14} />
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
