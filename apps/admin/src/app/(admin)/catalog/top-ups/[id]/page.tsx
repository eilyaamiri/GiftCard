import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiClientError, CATALOG_WRITE_ROLES, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { adminTopUpGameDetailSchema } from "../../_lib/catalog-contracts";
import { formatCount } from "../../_lib/format";
import { TopUpGameForm } from "../_components/topup-game-form";
import { TopUpOfferPanel } from "../_components/topup-offer-panel";

export const metadata = { title: "ویرایش بازی شارژ مستقیم | پنل ادمین سنتو" };

export default async function TopUpGameDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(CATALOG_WRITE_ROLES);
  const { id } = await params;

  let game;
  try {
    game = await api.get(`/api/admin/catalog/top-ups/${id}`, adminTopUpGameDetailSchema);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) notFound();
    throw error;
  }

  const supplierActive = game.supplier?.isActive ?? false;

  return (
    <div>
      <div className="breadcrumb">
        <Link href="/catalog/top-ups">شارژ مستقیم</Link>
        <span>/</span>
        <span>{game.nameFa ?? game.name}</span>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">کاتالوگ و تأمین</p>
          <h1>{game.nameFa ?? game.name}</h1>
        </div>
        <p className="muted bp-ltr">{game.slug}</p>
      </div>

      {/* The four gates, in the order the customer meets them. Stated plainly
          because "why is this not on the site?" is the question this page
          answers, and the answer is almost always one of these. */}
      <div className="card panel" style={{ marginBottom: 16 }}>
        <div className="section-label">
          <h3>وضعیت فروش</h3>
        </div>
        <ul style={{ margin: 0, paddingInlineStart: 18 }}>
          <Gate open={game.isActive} label="این بازی توسط شما فعال شده است" />
          <Gate open={game.isListed} label="تأمین‌کننده هنوز این بازی را ارائه می‌دهد" />
          <Gate open={supplierActive} label={`تأمین‌کننده (${game.supplier?.name ?? "—"}) فعال است`} />
          <Gate
            open={game.offers.some((offer) => offer.isActive)}
            label="حداقل یکی از بسته‌های زیر فعال است"
          />
        </ul>
        {game.lastSyncedAt ? (
          <p className="muted" style={{ marginBottom: 0, marginTop: 10 }}>
            آخرین همگام‌سازی: {new Date(game.lastSyncedAt).toLocaleString("fa-IR")}
          </p>
        ) : (
          <p className="muted" style={{ marginBottom: 0, marginTop: 10 }}>
            هنوز با تأمین‌کننده همگام‌سازی نشده است.
          </p>
        )}
      </div>

      <TopUpGameForm game={game} />

      {/* Read-only: these are what the customer is asked for before paying.
          Showing them here is how an operator checks the account form without
          placing a real order. */}
      <div className="card panel" style={{ marginTop: 16 }}>
        <div className="section-label">
          <h3>فیلدهای حساب مشتری</h3>
          <span>{formatCount(game.fields.length)} فیلد</span>
        </div>
        {game.fields.length === 0 ? (
          <p className="empty-hint">این بازی به ورودی نیاز ندارد.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>کلید</th>
                  <th>برچسب</th>
                  <th>نوع</th>
                  <th>اجباری</th>
                  <th>راهنما</th>
                </tr>
              </thead>
              <tbody>
                {game.fields.map((field) => (
                  <tr key={field.id}>
                    <td className="bp-ltr">{field.key}</td>
                    <td>{field.labelFa ?? field.label}</td>
                    <td className="bp-ltr">{field.fieldType}</td>
                    <td>{field.isRequired ? "بله" : "خیر"}</td>
                    <td className="muted">{field.helpTextFa ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TopUpOfferPanel offers={game.offers} />
    </div>
  );
}

function Gate({ open, label }: { open: boolean; label: string }) {
  return (
    <li>
      <span className={`badge ${open ? "badge-success" : "badge-danger"}`}>
        {open ? "برقرار" : "برقرار نیست"}
      </span>{" "}
      {label}
    </li>
  );
}
