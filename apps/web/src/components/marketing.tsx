import Link from "next/link";
import { ArrowLeft, Check, Globe2, LockKeyhole, Sparkles, Zap } from "lucide-react";
import { Ltr } from "@barat/ui";
import type { ProductDto } from "@barat/contracts";
import { api, ApiClientError } from "@/lib/api";
import { brandTone } from "@/lib/catalog-view";

export function ProductCard({ product }: { readonly product: ProductDto }) {
  return (
    <Link href={`/gift-cards/${product.slug}`} className="card product">
      <div className={`product-art ${brandTone(product.brand)}`}>{product.brand}</div>
      <div className="product-body">
        <h3>{product.titleFa}</h3>
        <div className="product-meta">
          <span>منطقه <Ltr>{product.regions.join("، ")}</Ltr></span>
          <span style={{ color: "var(--teal)", fontWeight: 700 }}>دریافت قیمت</span>
        </div>
      </div>
    </Link>
  );
}

async function featuredProducts(): Promise<readonly ProductDto[]> {
  try {
    const { items } = await api.products();
    return items.slice(0, 4);
  } catch (error) {
    // Marketing homepage degrades gracefully — a catalog hiccup should never
    // take the whole landing page down with it.
    if (error instanceof ApiClientError) return [];
    throw error;
  }
}

export async function HomePage() {
  const products = await featuredProducts();
  return (
    <>
      <main>
        <section className="hero">
          <div className="container hero-inner">
            <div>
              <div className="eyebrow">برات · دسترسی به جهان</div>
              <h1 className="h1">چیزی که در جهان می‌خواهید، همین‌جا.</h1>
              <p className="hero-copy">گیفت‌کارت بخرید یا هزینه سرویس‌های بین‌المللی را با خیال راحت پرداخت کنید. قیمت شفاف، پرداخت امن و پشتیبانی واقعی.</p>
              <div className="hero-actions">
                <Link className="btn btn-teal" href="/gift-cards">خرید گیفت‌کارت <ArrowLeft size={17} /></Link>
                <Link className="btn btn-outline" href="/services">پرداخت یک سرویس</Link>
              </div>
              <div className="trust-row">
                <span><Check size={14} /> قیمت نهایی قبل از پرداخت</span>
                <span><LockKeyhole size={14} /> پرداخت امن</span>
                <span><Zap size={14} /> پشتیبانی سریع</span>
              </div>
            </div>
            <div className="signal" aria-label="نمونه پیش‌فاکتور">
              <div className="signal-card">
                <div className="signal-label">نحوه محاسبه قیمت</div>
                <div className="signal-price">شفاف</div>
                <div className="signal-line"><span>ارزش گیفت‌کارت</span><span>بر اساس نرخ لحظه‌ای</span></div>
                <div className="signal-line"><span>کارمزد برات</span><span>پیش از پرداخت نمایش داده می‌شود</span></div>
                <div className="signal-total"><span>مبلغ نهایی</span><span>فقط پس از تأیید شما</span></div>
              </div>
            </div>
          </div>
        </section>
        <section className="container section">
          <div className="grid value-grid">
            <div className="card value">
              <div className="value-icon"><Sparkles /></div>
              <h3>قیمت، قبل از تصمیم</h3>
              <p>قیمت نهایی را همان لحظه می‌بینید؛ بدون هزینه پنهان و غافلگیری.</p>
            </div>
            <div className="card value">
              <div className="value-icon"><Globe2 /></div>
              <h3>برای دنیای واقعی</h3>
              <p>از اپل و استیم تا ابزارهای کاری و آموزشی؛ سرویس مورد نیازتان را پیدا کنید.</p>
            </div>
            <div className="card value">
              <div className="value-icon"><LockKeyhole /></div>
              <h3>پیگیری تا پایان</h3>
              <p>هر سفارش یک مسیر روشن دارد. وضعیت را آنلاین ببینید و با ما در تماس باشید.</p>
            </div>
          </div>
        </section>
        {products.length > 0 ? (
          <section className="container section">
            <div className="section-head">
              <div>
                <div className="eyebrow">انتخاب‌های محبوب</div>
                <h2 className="h2">شروع‌های مطمئن</h2>
              </div>
              <Link href="/gift-cards" className="btn btn-ghost">دیدن همه <ArrowLeft size={16} /></Link>
            </div>
            <div className="grid product-grid">
              {products.map((product) => <ProductCard key={product.id} product={product} />)}
            </div>
          </section>
        ) : null}
        <section className="container section">
          <div className="section-head">
            <div>
              <div className="eyebrow">ساده و شفاف</div>
              <h2 className="h2">سه قدم تا مقصد</h2>
            </div>
          </div>
          <div className="grid steps">
            <div className="card step">
              <span className="step-num">انتخاب</span>
              <h3>چیزی را که می‌خواهید پیدا کنید</h3>
              <p className="muted">گیفت‌کارت یا سرویس خارجی را انتخاب کنید و جزئیات را وارد کنید.</p>
            </div>
            <div className="card step">
              <span className="step-num">قیمت‌گذاری</span>
              <h3>قیمت نهایی را ببینید</h3>
              <p className="muted">نرخ و کارمزد شفاف است؛ تا زمانی که تأیید نکنید چیزی قطعی نمی‌شود.</p>
            </div>
            <div className="card step">
              <span className="step-num">تحویل</span>
              <h3>با خیال راحت تحویل بگیرید</h3>
              <p className="muted">پرداخت را انجام دهید و وضعیت سفارش را از پنل خود دنبال کنید.</p>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
