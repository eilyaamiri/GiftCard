"use client";

import { useRouter } from "next/navigation";
import { useState, type CSSProperties, type FormEvent } from "react";
import { ApiClientError, api, landingPathForRole, staffLoginRequestSchema } from "@/lib/api";

const labelStyle: CSSProperties = {
  display: "block",
  marginBlockEnd: "7px",
  color: "#13243a",
  fontSize: "12px",
  fontWeight: 700,
};

const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: "44px",
  padding: "0 12px",
  color: "#13243a",
  background: "#f6f8fa",
  border: "1px solid #e6ebf0",
  borderRadius: "10px",
  fontFamily: "inherit",
  fontSize: "13px",
  boxSizing: "border-box",
};

function messageFor(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 401) return "ایمیل یا گذرواژه نادرست است.";
    if (error.status === 403) return "این حساب اجازهٔ ورود به پنل را ندارد.";
    if (error.status === 429) return "تعداد تلاش‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.";
    return error.message;
  }
  return "ارتباط با سرویس ممکن نیست. دوباره تلاش کنید.";
}

export function LoginForm({ nextPath }: { nextPath: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = staffLoginRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError("ایمیل و گذرواژه را کامل و درست وارد کنید.");
      return;
    }

    setPending(true);
    try {
      const staff = await api.staffLogin(parsed.data);
      // The credential lives only in this call stack: never logged, never stored,
      // never placed in the URL.
      setPassword("");
      router.replace(nextPath ?? landingPathForRole(staff.role));
      router.refresh();
    } catch (caught) {
      setError(messageFor(caught));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div style={{ marginBlockEnd: "16px" }}>
        <label htmlFor="staff-email" style={labelStyle}>
          ایمیل سازمانی
        </label>
        <input
          id="staff-email"
          name="email"
          type="email"
          dir="ltr"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          style={{ ...inputStyle, textAlign: "left" }}
        />
      </div>

      <div style={{ marginBlockEnd: "20px" }}>
        <label htmlFor="staff-password" style={labelStyle}>
          گذرواژه
        </label>
        <input
          id="staff-password"
          name="password"
          type="password"
          dir="ltr"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          style={{ ...inputStyle, textAlign: "left" }}
        />
      </div>

      {error ? (
        <p
          role="alert"
          style={{
            margin: "0 0 16px",
            padding: "11px 13px",
            borderRadius: "10px",
            background: "#fff5f5",
            border: "1px solid #f6dcdc",
            color: "#a83232",
            fontSize: "12px",
            lineHeight: 1.8,
          }}
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        style={{
          width: "100%",
          minHeight: "46px",
          color: "#ffffff",
          background: pending ? "#7fc9c7" : "#21b4b0",
          border: 0,
          borderRadius: "10px",
          fontFamily: "inherit",
          fontSize: "14px",
          fontWeight: 800,
          cursor: pending ? "progress" : "pointer",
        }}
      >
        {pending ? "در حال ورود…" : "ورود به پنل"}
      </button>
    </form>
  );
}
