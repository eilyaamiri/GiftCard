import Link from "next/link";
import { ArrowLeft, Check, Globe2, LockKeyhole, Sparkles, Zap } from "lucide-react";
import { api, ApiClientError } from "@/lib/api";
import type { CatalogProduct, Category } from "@/lib/catalog";
import { CatalogProductCard } from "@/components/catalog-product-card";
import { CategoryIcon } from "@/components/category-icon";

const FEATURED_COUNT = 4;

/**
 * The category row under the hero.
 *
 * Same graceful-degradation shape as `featuredProducts`: a catalog hiccup
 * hides the row rather than breaking the landing page.
 */
async function homeCategories(): Promise<readonly Category[]> {
  try {
    const { items } = await api.categories();
    return items;
  } catch (error) {
    if (error instanceof ApiClientError) return [];
    throw error;
  }
}

/**
 * The cards on the landing page.
 *
 * «نمایش در انتخاب سریع» is a flag an operator sets per product, so the strip
 * is curated from the panel rather than being whatever the catalog happens to
 * return first. With nothing flagged — or fewer than four — the rest of the
 * page fills in behind them, so the section is never half empty.
 */
async function featuredProducts(): Promise<readonly CatalogProduct[]> {
  try {
    const { items } = await api.products();
    const quickPicks = items.filter((product) => product.isQuickPick);
    const rest = items.filter((product) => !product.isQuickPick);
    return [...quickPicks, ...rest].slice(0, FEATURED_COUNT);
  } catch (error) {
    // Marketing homepage degrades gracefully — a catalog hiccup should never
    // take the whole landing page down with it.
    if (error instanceof ApiClientError) return [];
    throw error;
  }
}

export async function HomePage() {
  const [products, categories] = await Promise.all([featuredProducts(), homeCategories()]);
  return (
    <>
      <main>
        <section className="hero">
          <div className="container hero-inner">
            <div className="hero-content">
              <div className="eyebrow">برات · دسترسی به جهان</div>
              <h1 className="h1">چیزی که در جهان می‌خواهید، همین‌جا در دسترس برات.</h1>
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
        {categories.length > 0 ? (
          <section className="container category-tiles-section">
            <div className="category-tiles">
              {categories.map((category) => (
                <Link
                  key={category.id}
                  href={`/gift-cards?category=${encodeURIComponent(category.slug)}`}
                  className="category-tile"
                >
                  <span className="category-tile-icon" aria-hidden="true">
                    <CategoryIcon iconKey={category.iconKey} size={16} />
                  </span>
                  <span className="category-tile-label">{category.nameFa}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
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
              {products.map((product) => <CatalogProductCard key={product.id} product={product} />)}
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
