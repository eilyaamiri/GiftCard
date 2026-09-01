import Link from "next/link";
import { Sparkles } from "lucide-react";

export function ComingSoon({ title }: { readonly title: string }) {
  return (
    <main className="page container" style={{ maxWidth: 520, textAlign: "center" }}>
      <div className="card pad" style={{ padding: 44 }}>
        <span className="value-icon" style={{ margin: "0 auto 16px" }}><Sparkles /></span>
        <h1 className="h2">{title}</h1>
        <p className="muted">این سرویس به‌زودی راه‌اندازی می‌شود. در حال حاضر می‌توانید از گیفت‌کارت‌ها یا پرداخت بین‌المللی استفاده کنید.</p>
        <Link className="btn btn-primary" href="/gift-cards" style={{ marginTop: 12 }}>مشاهده گیفت‌کارت‌ها</Link>
      </div>
    </main>
  );
}
