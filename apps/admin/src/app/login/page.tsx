import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "ورود کارکنان | سنتو",
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
          <img
            src="/brand/cento/cento-app-icon-dark-128.png"
            alt=""
            width={38}
            height={38}
            style={{ display: "block", borderRadius: "10px", boxShadow: "0 6px 16px #0b1d3333" }}
          />
          <div>
            <img
              src="/brand/cento/cento-fa-dark.png"
              alt="سنتو"
              width={1163}
              height={360}
              style={{ display: "block", height: "21px", width: "auto", marginBlockEnd: "4px" }}
            />
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
