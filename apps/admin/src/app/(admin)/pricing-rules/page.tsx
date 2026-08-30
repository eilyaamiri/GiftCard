export const metadata = { title: "قواعد قیمت‌گذاری | پنل ادمین برات پی" };

interface BpsField {
  key: string;
  label: string;
  value: number;
  hint: string;
}

const bpsFields: BpsField[] = [
  { key: "fxSpreadBps", label: "اسپرد نرخ ارز (bps)", value: 150, hint: "۱۵۰ bps = ۱٫۵٪" },
  { key: "fxRiskBufferBps", label: "بافر ریسک نرخ ارز (bps)", value: 50, hint: "۵۰ bps = ۰٫۵٪" },
  { key: "serviceFeeBps", label: "کارمزد سرویس (bps)", value: 200, hint: "۲۰۰ bps = ۲٪" },
  { key: "targetMarginBps", label: "حاشیهٔ سود هدف (bps)", value: 800, hint: "۸۰۰ bps = ۸٪" },
  { key: "paymentFeeBps", label: "کارمزد درگاه پرداخت (bps)", value: 145, hint: "۱۴۵ bps = ۱٫۴۵٪" },
  { key: "maxSupplierCostToleranceBps", label: "سقف تلورانس هزینهٔ تأمین‌کننده (bps)", value: 300, hint: "۳۰۰ bps = ۳٪ — فراتر از این نیاز به تأیید مدیر" },
];

const fixedFields = [
  { key: "serviceFeeFixedIrr", label: "کارمزد ثابت سرویس (تومان)", value: "15,000" },
  { key: "operationalFeeIrr", label: "هزینهٔ عملیاتی ثابت (تومان)", value: "8,000" },
  { key: "paymentFeeFixedIrr", label: "کارمزد ثابت درگاه (تومان)", value: "0" },
  { key: "minimumMarginIrr", label: "حداقل حاشیهٔ سود (تومان)", value: "40,000" },
];

const otherFields = [
  { key: "quoteTtlSeconds", label: "مدت اعتبار استعلام (ثانیه)", value: "300" },
  { key: "roundingStepIrr", label: "پلهٔ گرد کردن مبلغ نهایی (ریال)", value: "10,000" },
];

export default function PricingRulesPage() {
  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">قیمت‌گذاری و ارز</p>
          <h1>قواعد قیمت‌گذاری</h1>
        </div>
        <p className="muted">هیچ مقدار hardcode نیست — همه از طریق این فرم به موتور قیمت‌گذاری اعمال می‌شود</p>
      </div>

      <div className="card panel">
        <div className="section-label">
          <h3>پارامترهای basis-point (۱۰۰ bps = ۱٪)</h3>
        </div>
        <div className="form-grid">
          {bpsFields.map((field) => (
            <label key={field.key}>
              {field.label}
              <input type="number" defaultValue={field.value} min={0} className="bp-ltr" />
              <span className="muted" style={{ fontWeight: 400 }}>{field.hint}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="card panel" style={{ marginTop: 16 }}>
        <div className="section-label">
          <h3>مبالغ ثابت (تومان)</h3>
        </div>
        <div className="form-grid">
          {fixedFields.map((field) => (
            <label key={field.key}>
              {field.label}
              <input type="text" defaultValue={field.value} inputMode="numeric" className="bp-ltr" />
            </label>
          ))}
        </div>
      </div>

      <div className="card panel" style={{ marginTop: 16 }}>
        <div className="section-label">
          <h3>سایر پارامترها</h3>
        </div>
        <div className="form-grid">
          {otherFields.map((field) => (
            <label key={field.key}>
              {field.label}
              <input type="text" defaultValue={field.value} inputMode="numeric" className="bp-ltr" />
            </label>
          ))}
        </div>
        <div className="save-row">
          <button type="button" className="secondary-btn" style={{ marginLeft: 10 }}>بازنشانی</button>
          <button type="submit" className="primary-btn">ذخیرهٔ قواعد قیمت‌گذاری</button>
        </div>
      </div>
    </div>
  );
}
