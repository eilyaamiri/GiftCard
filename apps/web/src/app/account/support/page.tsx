"use client";
import { useState } from "react";
import { Input, Label, Textarea, Select } from "@barat/ui";
import { AccountNav } from "@/components/account-nav";

export default function AccountSupportPage() {
  const [sent, setSent] = useState(false);

  return (
    <main className="page container" style={{ maxWidth: 560 }}>
      <div className="eyebrow">حساب کاربری</div>
      <h1 className="h2">پشتیبانی</h1>
      <AccountNav />
      {sent ? (
        <div className="card pad" style={{ textAlign: "center" }}>
          <h3>پیام شما ارسال شد</h3>
          <p className="muted">تیم پشتیبانی به‌زودی با شما در تماس خواهد بود.</p>
        </div>
      ) : (
        <form className="card pad" onSubmit={(e) => { e.preventDefault(); setSent(true); }}>
          <div className="field">
            <Label htmlFor="orderNumber">شماره سفارش (اختیاری)</Label>
            <Input id="orderNumber" ltr placeholder="ORD-XXXXXXXX" />
          </div>
          <div className="field">
            <Label htmlFor="topic">موضوع</Label>
            <Select id="topic" placeholder="انتخاب کنید" options={[{ value: "order", label: "پیگیری سفارش" }, { value: "payment", label: "مشکل پرداخت" }, { value: "other", label: "سایر" }]} />
          </div>
          <div className="field">
            <Label htmlFor="message" required>پیام</Label>
            <Textarea id="message" required placeholder="مشکل خود را شرح دهید..." />
          </div>
          <button type="submit" className="btn btn-primary">ارسال پیام</button>
        </form>
      )}
    </main>
  );
}
