"use client";
import { useState } from "react";
import { Input, Label } from "@barat/ui";
import { AccountNav } from "@/components/account-nav";

export default function AccountProfilePage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  return (
    <main className="page container" style={{ maxWidth: 640 }}>
      <div className="eyebrow">حساب کاربری</div>
      <h1 className="h2">اطلاعات حساب</h1>
      <AccountNav />
      <form className="card pad" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <Label htmlFor="firstName">نام</Label>
          <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div className="field">
          <Label htmlFor="lastName">نام خانوادگی</Label>
          <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <div className="field">
          <Label htmlFor="mobile">موبایل تأیید‌شده</Label>
          <Input id="mobile" ltr disabled value="0912***4567" />
        </div>
        <button type="submit" className="btn btn-primary">ذخیره تغییرات</button>
      </form>
    </main>
  );
}
