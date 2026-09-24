import Link from "next/link";
import { ArrowLeft, Check, Globe2, LockKeyhole, Sparkles, Zap } from "lucide-react";
import type { InternationalServiceDto } from "@barat/contracts";
import { api, ApiClientError } from "@/lib/api";
import { visibleBrandsQuery } from "@/lib/brand-art";
import type { CatalogProduct, Category } from "@/lib/catalog";
import { CatalogProductCard } from "@/components/catalog-product-card";
import { CategoryIcon } from "@/components/category-icon";
import { FaqSection } from "@/components/faq";
import { ServiceCard } from "@/components/service-card";
import { getFaqs } from "@/lib/faq";

/**
 * Every strip on the landing page is the same width — four cards — so the page
 * reads as a stack of equal shelves rather than one long wall of catalog. A
 * category that cannot fill a shelf does not get one.
 */
const ROW_SIZE = 4;
/** Category shelves shown below the curated one. */
const MAX_CATEGORY_ROWS = 4;
/**
 * How many categories we are willing to fetch to find those shelves. The
 * published `productCount` counts everything in the category; eligibility
 * (orderable, not under review) is only knowable per product, so a few
 * candidates are expected to fall short and we ask for more than we need.
 */
const CATEGORY_CANDIDATES = MAX_CATEGORY_ROWS + 3;
/**
 * The category the curated strip is built from. Matched by name, not slug —
 * the slug this category is seeded under differs by environment.
 */
const FEATURED_CATEGORY_NAME_FA = "عمومی و پرکاربرد";

/**
 * The category row under the hero.
 *
 * Same graceful-degradation shape as `categoryProducts`: a catalog hiccup
 * hides the row rather than breaking the landing page.
 */
async function homeCategories(): Promise<readonly Category[]> {
  try {
    const { items } = await api.categories(visibleBrandsQuery());
    return items;
  } catch (error) {
    if (error instanceof ApiClientError) return [];
    throw error;
  }
}

/**
 * Products in one category, fetched directly rather than paged through the
 * whole catalog — the catalog is large enough now that an unfiltered
 * first page can easily miss this category's products entirely. Degrades
 * the same way `homeCategories` does.
 */
async function categoryProducts(categorySlug: string): Promise<readonly CatalogProduct[]> {
  try {
    const { items } = await api.products(
      `categorySlug=${encodeURIComponent(categorySlug)}&pageSize=100&${visibleBrandsQuery()}`,
    );
    return items;
  } catch (error) {
    // Marketing homepage degrades gracefully — a catalog hiccup should never
    // take the whole landing page down with it.
    if (error instanceof ApiClientError) return [];
    throw error;
  }
}

/** The international-payment strip. Degrades like every other row here. */
async function homeServices(): Promise<readonly InternationalServiceDto[]> {
  try {
    const { items } = await api.services();
    return items.filter((service) => service.isActive).slice(0, ROW_SIZE);
  } catch (error) {
    if (error instanceof ApiClientError) return [];
    throw error;
  }
}

/**
 * What a customer can actually buy today — the same `orderable` rule
 * `CatalogProductCard` renders by — so the first thing a visitor sees is never
 * a disabled "فعلاً قابل سفارش نیست" card. «نمایش در انتخاب سریع» is a flag an
 * operator sets per product, so each shelf is curated from the panel rather
 * than being whatever the catalog happens to return first.
 */
function shelfProducts(
  products: readonly CatalogProduct[],
  taken: ReadonlySet<string>,
): readonly CatalogProduct[] {
  const eligible = products.filter(
    (product) => !product.needsReview && product.regions.length > 0 && !taken.has(product.id),
  );
  const quickPicks = eligible.filter((product) => product.isQuickPick);
  const rest = eligible.filter((product) => !product.isQuickPick);
  return [...quickPicks, ...rest].slice(0, ROW_SIZE);
}

type Shelf = {
  readonly key: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly href: string;
  readonly products: readonly CatalogProduct[];
};

/**
 * The shelves, in the order the page shows them: the curated one first, then
 * whichever categories can fill a full row, in the order an operator sorted
 * them. A product appears once across the whole page — a card repeated two
 * shelves apart looks like a bug, not a recommendation.
 */
async function homeShelves(categories: readonly Category[]): Promise<readonly Shelf[]> {
  const featured = categories.find((category) => category.nameFa === FEATURED_CATEGORY_NAME_FA);
  const candidates = categories
    .filter((category) => category.slug !== featured?.slug && category.productCount >= ROW_SIZE)
    .slice(0, CATEGORY_CANDIDATES);

  const [featuredItems, ...candidateItems] = await Promise.all([
    featured === undefined ? Promise.resolve([] as readonly CatalogProduct[]) : categoryProducts(featured.slug),
    ...candidates.map((category) => categoryProducts(category.slug)),
  ]);

  const taken = new Set<string>();
  const shelves: Shelf[] = [];

  const push = (shelf: Omit<Shelf, "products">, items: readonly CatalogProduct[]): boolean => {
    const products = shelfProducts(items, taken);
    if (products.length < ROW_SIZE) return false;
    for (const product of products) taken.add(product.id);
    shelves.push({ ...shelf, products });
    return true;
  };

  push({ key: "featured", eyebrow: "انتخاب‌های محبوب", title: "شروع‌های مطمئن", href: "/gift-cards" }, featuredItems);

  let categoryRows = 0;
  for (const [index, category] of candidates.entries()) {
    if (categoryRows >= MAX_CATEGORY_ROWS) break;
    const shown = push(
      {
        key: category.id,
        eyebrow: "دسته‌بندی",
        title: category.nameFa,
        href: `/gift-cards?category=${encodeURIComponent(category.slug)}`,
      },
      candidateItems[index] ?? [],
    );
    if (shown) categoryRows += 1;
  }

  return shelves;
}

/** A section head with its own way through to the full list. */
function ShelfHead({
  eyebrow,
  title,
  href,
}: Readonly<{ eyebrow: string; title: string; href: string }>) {
  return (
    <div className="section-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2 className="h2">
          <Link href={href} className="section-head-link">{title}</Link>
        </h2>
      </div>
      <Link href={href} className="btn btn-ghost">دیدن همه <ArrowLeft size={16} /></Link>
    </div>
  );
}

/** How long the headline takes to fully type itself in, ~50 characters at this pace. */
const HERO_TYPE_CHAR_DELAY_MS = 22;
/** Lets the hero block's own fade/slide finish before the headline starts typing. */
const HERO_TYPE_START_DELAY_MS = 550;

/**
 * The hero headline, typed in one word at a time.
 *
 * Every word is already in the markup — this only staggers each word's
 * `opacity` via a precomputed `animation-delay`, so the full sentence is there
 * for SEO and for a reader with no JavaScript; only the paint is staggered.
 * Staggering by word rather than by character matters here: Persian is a
 * cursive script, and a `<span>` per character breaks the browser's letter
 * shaping mid-word (joined letters render in their isolated form instead),
 * which is exactly what happened when this was tried per-character. A word
 * is never split across elements, so its letters still shape as one run.
 * `aria-label` carries the real sentence so a screen reader gets it whole
 * instead of one span at a time.
 */
function TypewriterHeading({ text, className }: Readonly<{ text: string; className?: string }>) {
  const words = text.split(" ");
  let charCount = 0;
  const parts = words.map((word) => {
    const delay = HERO_TYPE_START_DELAY_MS + charCount * HERO_TYPE_CHAR_DELAY_MS;
    charCount += word.length + 1;
    return { word, delay };
  });
  const cursorDelay = HERO_TYPE_START_DELAY_MS + Array.from(text).length * HERO_TYPE_CHAR_DELAY_MS;
  return (
    <h1 className={className} aria-label={text}>
      <span aria-hidden="true">
        {parts.map(({ word, delay }, index) => (
          <span key={index}>
            <span className="hero-typewriter-word" style={{ animationDelay: `${delay}ms` }}>
              {word}
            </span>
            {index < parts.length - 1 ? " " : null}
          </span>
        ))}
        <span className="hero-typewriter-cursor" style={{ animationDelay: `${cursorDelay}ms` }} />
      </span>
    </h1>
  );
}

export async function HomePage() {
  const categories = await homeCategories();
  const [shelves, services, faqs] = await Promise.all([
    homeShelves(categories),
    homeServices(),
    getFaqs(),
  ]);
  return (
    <>
      <main>
        <section className="hero">
          <div className="container hero-inner">
            <div className="hero-content">
              <div className="eyebrow">برات · دسترسی به جهان</div>
              <TypewriterHeading text="چیزی که در جهان می‌خواهید، همین‌جا در دسترس برات." className="h1" />
              <p className="hero-copy">گیفت‌کارت بخرید یا هزینه سرویس‌های بین‌المللی را با خیال راحت پرداخت کنید. قیمت شفاف، پرداخت امن و پشتیبانی واقعی.</p>
              <div className="hero-actions">
                <Link className="btn btn-accent" href="/gift-cards">خرید گیفت‌کارت <ArrowLeft size={17} /></Link>
                <Link className="btn btn-outline" href="/services">پرداخت یک سرویس</Link>
              </div>
              <div className="trust-row">
                <span><Check size={14} /> قیمت نهایی قبل از پرداخت</span>
                <span><LockKeyhole size={14} /> پرداخت امن</span>
                <span><Zap size={14} /> پشتیبانی سریع</span>
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
        {/* One stack, not six unrelated sections — the shelves share a tighter
            rhythm with each other than a section does with the page. */}
        <div className="shelf-stack">
          {shelves.map((shelf) => (
            <section key={shelf.key} className="container section">
              <ShelfHead eyebrow={shelf.eyebrow} title={shelf.title} href={shelf.href} />
              <div className="grid product-grid">
                {shelf.products.map((product) => <CatalogProductCard key={product.id} product={product} />)}
              </div>
            </section>
          ))}
          {services.length > 0 ? (
            <section className="container section">
              <ShelfHead eyebrow="پرداخت بین‌المللی" title="هزینه سرویس‌های خارجی" href="/services" />
              <div className="grid product-grid">
                {services.map((service) => <ServiceCard key={service.slug} service={service} />)}
              </div>
            </section>
          ) : null}
        </div>
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
        {/* The last thing before the footer, because it answers the question a
            visitor is left holding once the page has finished selling. */}
        <FaqSection entries={faqs} />
      </main>
    </>
  );
}
