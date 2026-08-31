import { toPersianDigits } from "@barat/ui";
import type { SupportTicket } from "@/lib/support-tickets";
import {
  FIRST_RESPONSE_SLA_MINUTES,
  NEXT_RESPONSE_SLA_MINUTES,
  calculateTicketSlaMetrics,
} from "@/lib/ticket-sla-metrics";

function number(value: number): string {
  return toPersianDigits(value.toLocaleString("en-US"));
}

function durationLabel(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${number(minutes)} دقیقه`;
  const remainder = minutes % 60;
  return remainder === 0
    ? `${number(Math.floor(minutes / 60))} ساعت`
    : `${number(Math.floor(minutes / 60))} ساعت و ${number(remainder)} دقیقه`;
}

function attainment(value: number | null): string {
  return value === null ? "—" : `${number(value)}٪`;
}

export function TicketSlaReport({
  tickets,
  personal = false,
  operatorName = null,
}: Readonly<{ tickets: readonly SupportTicket[]; personal?: boolean; operatorName?: string | null }>) {
  const metrics = calculateTicketSlaMetrics(tickets);
  // A personal view still counts colleagues' replies on shared threads, so the
  // per-agent table is narrowed to the viewer's own row.
  const operatorRows = operatorName === null ? metrics.byOperator : metrics.byOperator.filter((row) => row.label === operatorName);

  return (
    <>
      <section className="card panel report-section">
        <div className="section-label">
          <h2>{personal ? "SLA تیکت‌های من" : "SLA پشتیبانی و تیکت‌ها"}</h2>
          <span>
            تعهد پاسخ اول: {number(FIRST_RESPONSE_SLA_MINUTES)} دقیقه · تعهد پاسخ‌های بعدی: {number(NEXT_RESPONSE_SLA_MINUTES)} دقیقه
          </span>
        </div>

        <div className="kpi-grid">
          <Metric label="تیکت باز" value={number(metrics.open)} foot={`${number(metrics.total)} تیکت در بازه`} />
          <Metric
            label="در انتظار پاسخ پشتیبانی"
            value={number(metrics.awaitingStaff)}
            foot={`${number(metrics.unassigned)} تیکت بدون مالک`}
            danger={metrics.awaitingStaff > 0}
          />
          <Metric label="نقض SLA فعال" value={number(metrics.overdueNow)} foot="از deadline پاسخ گذشته است" danger={metrics.overdueNow > 0} />
          <Metric
            label="تحقق SLA پاسخ اول"
            value={attainment(metrics.firstResponseAttainment)}
            foot={`${number(metrics.firstResponseMet)} از ${number(metrics.firstResponseEvaluated)} پاسخ اول`}
          />
          <Metric label="میانگین پاسخ اول" value={durationLabel(metrics.averageFirstResponseMinutes)} foot="از ثبت تیکت تا نخستین پاسخ" />
          <Metric
            label="تحقق SLA پاسخ‌های بعدی"
            value={attainment(metrics.followUpAttainment)}
            foot={`${number(metrics.followUpMet)} از ${number(metrics.followUpEvaluated)} پاسخ`}
          />
          <Metric label="میانگین پاسخ‌های بعدی" value={durationLabel(metrics.averageFollowUpMinutes)} foot="از پیام مشتری تا پاسخ کارشناس" />
          <Metric label="جابه‌جایی مالکیت" value={number(metrics.ownerHandoffs)} foot="پاسخ کارشناس دیگر در میانهٔ تیکت" />
        </div>
      </section>

      {operatorRows.length > 0 ? (
        <section className="card panel report-section">
          <div className="section-label">
            <h2>{personal ? "عملکرد من در پاسخ‌گویی" : "عملکرد کارشناسان در پاسخ‌گویی"}</h2>
            <span>بر پایهٔ پیام‌های ثبت‌شده در تیکت‌ها</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>کارشناس</th>
                  <th>پاسخ‌ها</th>
                  <th>تیکت باز تحت مالکیت</th>
                  <th>پاسخ اول (تحقق SLA)</th>
                  <th>پاسخ بعدی (تحقق SLA)</th>
                  <th>میانگین زمان پاسخ</th>
                  <th>تحویل‌گیری مالکیت</th>
                </tr>
              </thead>
              <tbody>
                {operatorRows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td>{number(row.replies)}</td>
                    <td>{number(row.ownedOpen)}</td>
                    <td>
                      {number(row.firstResponses)}
                      <span className="table-subline">{attainment(row.firstResponses === 0 ? null : Math.round((row.firstResponsesMet / row.firstResponses) * 100))}</span>
                    </td>
                    <td>
                      {number(row.followUps)}
                      <span className="table-subline">{attainment(row.followUps === 0 ? null : Math.round((row.followUpsMet / row.followUps) * 100))}</span>
                    </td>
                    <td>{durationLabel(row.averageResponseMinutes)}</td>
                    <td>{number(row.takeovers)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="card panel report-section">
          <div className="empty-hint">هنوز پاسخی برای محاسبهٔ SLA تیکت ثبت نشده است.</div>
        </section>
      )}
    </>
  );
}

function Metric({ label, value, foot, danger = false }: { label: string; value: string; foot: string; danger?: boolean }) {
  return (
    <div className="card kpi" style={{ ["--accent" as string]: danger ? "#d94a4a" : "#21b4b0", ["--tint" as string]: danger ? "#fdeceb" : "#dff7f5" }}>
      <div className="kpi-top"><span>{label}</span></div>
      <p className="kpi-value">{value}</p>
      <p className={`kpi-trend ${danger ? "trend-down" : "trend-neutral"}`}>{foot}</p>
    </div>
  );
}
