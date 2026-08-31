import Link from "next/link";
import { ErrorState } from "@barat/ui";

export default function ServiceNotFound() {
  return (
    <main className="page container" style={{ maxWidth: 560 }}>
      <ErrorState
        title="این سرویس پیدا نشد"
        description="ممکن است لینک اشتباه باشد یا این سرویس دیگر ارائه نشود."
        action={<Link className="btn btn-primary" href="/services">بازگشت به سرویس‌ها</Link>}
      />
    </main>
  );
}
