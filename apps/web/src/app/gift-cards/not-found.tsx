import Link from "next/link";
import { ErrorState } from "@barat/ui";

export default function GiftCardNotFound() {
  return (
    <main className="page container">
      <ErrorState
        title="این گیفت‌کارت پیدا نشد"
        description="ممکن است لینک اشتباه باشد یا این محصول دیگر موجود نباشد."
        action={<Link className="btn btn-primary" href="/gift-cards">بازگشت به کاتالوگ</Link>}
      />
    </main>
  );
}
