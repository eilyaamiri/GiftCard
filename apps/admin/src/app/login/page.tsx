import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "ورود کارکنان | برات پی",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** Anything that is not a same-origin path is discarded, not sanitised. */
function safeNextPath(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) return null;
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return null;
  return candidate;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const forbidden = params["reason"] === "forbidden";

  return (
    <main
      dir="rtl"
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px 16px",
        background: "linear-gradient(160deg, #081727 0%, #0b1d33 55%, #102a46 100%)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "400px",
          background: "#ffffff",
          borderRadius: "18px",
          padding: "clamp(22px, 6vw, 32px)",
          boxShadow: "0 20px 50px #0000004d",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "11px", marginBlockEnd: "26px" }}>
          <div
            aria-hidden
            style={{
              width: "38px",
              height: "38px",
              display: "grid",
              placeItems: "center",
              color: "#0b1d33",
              background: "#21b4b0",
              borderRadius: "12px 12px 4px 12px",
              fontSize: "19px",
              fontWeight: 900,
            }}
          >
            ب
          </div>
          <div>
            <strong style={{ display: "block", fontSize: "17px", color: "#13243a" }}>برات پی</strong>
            <small style={{ color: "#6b7c93", fontSize: "11px" }}>ورود کارکنان</small>
          </div>
        </div>

        {forbidden ? (
          <p
            role="status"
            style={{
              margin: "0 0 18px",
              padding: "11px 13px",
              borderRadius: "10px",
              background: "#fff6ed",
              border: "1px solid #f3ddc3",
              color: "#8a5a12",
              fontSize: "12px",
              lineHeight: 1.8,
            }}
          >
            نقش کاربری شما اجازهٔ دسترسی به آن بخش را ندارد. با حساب مجاز وارد شوید.
          </p>
        ) : null}

        <LoginForm nextPath={safeNextPath(params["next"])} />
      </div>
    </main>
  );
}
