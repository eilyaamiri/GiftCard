import { SimulatorForm } from "./simulator-form";

export const metadata = { title: "شبیه‌ساز استعلام | پنل ادمین برات پی" };

export default function SimulatorPage() {
  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">قیمت‌گذاری و ارز</p>
          <h1>شبیه‌ساز استعلام</h1>
        </div>
        <p className="muted">همان تابع هستهٔ قیمت‌گذاری را باید صدا بزند — نه یک کپی جدا از فرمول</p>
      </div>
      <SimulatorForm />
    </div>
  );
}
