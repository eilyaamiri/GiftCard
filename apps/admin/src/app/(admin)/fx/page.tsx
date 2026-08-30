import { formatToman, toPersianDigits } from "@barat/ui";

export const metadata = { title: "نرخ ارز | پنل ادمین برات پی" };

const history = [
  { time: "۰۸:۰۰", rate: 1_915_000n },
  { time: "۰۹:۰۰", rate: 1_918_000n },
  { time: "۱۰:۰۰", rate: 1_922_000n },
  { time: "۱۱:۰۰", rate: 1_919_000n },
  { time: "۱۲:۰۰", rate: 1_920_000n },
];

export default function FxPage() {
  const firstRate = history[0]?.rate ?? 0n;
  const maxRate = history.reduce((max, point) => (point.rate > max ? point.rate : max), firstRate);
  const minRate = history.reduce((min, point) => (point.rate < min ? point.rate : min), firstRate);
  const span = maxRate - minRate || 1n;

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">قیمت‌گذاری و ارز</p>
          <h1>نرخ ارز USD/IRR</h1>
        </div>
        <p className="muted">تازگی نرخ هر ۹۰ ثانیه بررسی می‌شود</p>
      </div>

      <div className="stat-strip">
        <div className="card stat-tile"><span>نرخ فعلی</span><strong className="bp-ltr">{formatToman(1_920_000n)}</strong></div>
        <div className="card stat-tile"><span>Provider اصلی</span><strong>PrimaryFX — <span className="freshness-good">به‌روز</span></strong></div>
        <div className="card stat-tile"><span>سن نرخ</span><strong>{toPersianDigits("42")} ثانیه</strong></div>
        <div className="card stat-tile"><span>حالت</span><strong>خودکار (بدون override)</strong></div>
      </div>

      <div className="two-col">
        <div className="card panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">تاریخچهٔ نرخ — امروز</h2>
              <p className="panel-caption">تومان به ازای هر دلار</p>
            </div>
          </div>
          <div className="volume-chart">
            {history.map((point) => (
              <div key={point.time} className="bar-column">
                <span className="bar-value bp-ltr">{formatToman(point.rate, { withSuffix: false })}</span>
                <div className="bar" style={{ height: `${10n + ((point.rate - minRate) * 80n) / span}%` }} />
                <span className="bar-label bp-ltr">{point.time}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card panel">
          <div className="panel-heading">
            <h2 className="panel-title">Override دستی نرخ</h2>
          </div>
          <form className="form-grid">
            <label style={{ gridColumn: "1 / -1" }}>
              نرخ جدید (تومان)
              <input type="text" inputMode="numeric" placeholder="مثلاً ۱۹۲۵۰۰۰" className="bp-ltr" />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              دلیل override (الزامی، در گزارش رخداد ثبت می‌شود)
              <textarea placeholder="مثلاً: قطع اتصال به Provider اصلی و ثانویه به مدت ۱۰ دقیقه" />
            </label>
            <label>
              TTL این override (دقیقه)
              <input type="number" defaultValue={30} min={1} />
            </label>
            <div style={{ alignSelf: "end" }}>
              <button type="submit" className="primary-btn" style={{ width: "100%" }}>ثبت Override</button>
            </div>
          </form>
          <p className="warning" style={{ marginTop: 16 }}>در زمان فعال بودن override، هر استعلام جدید با علامت «override فعال است» ثبت خواهد شد و در گزارش رخدادها قابل ردیابی است.</p>
        </div>
      </div>
    </div>
  );
}
