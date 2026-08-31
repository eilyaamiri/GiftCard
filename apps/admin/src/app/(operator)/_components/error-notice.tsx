import { ApiClientError } from "@/lib/api";

/**
 * The API already speaks Persian for anything an operator can cause, so its
 * message is preferred over a generic one. Anything else is a fault on our side
 * and gets a neutral sentence rather than a stack trace on a work screen.
 */
export function messageFor(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return "ارتباط با سرویس ممکن نشد. لطفاً دوباره تلاش کنید.";
}

export function ErrorNotice({ error, title }: { error: unknown; title?: string }) {
  return (
    <div className="card" style={{ padding: 20, borderColor: "#f3caca", background: "#fff5f4" }}>
      <h3 style={{ margin: 0, fontSize: 15, color: "#b73a3a" }}>{title ?? "خطا در بارگذاری"}</h3>
      <p className="muted" style={{ marginBlockStart: 8, marginBlockEnd: 0 }}>
        {messageFor(error)}
      </p>
    </div>
  );
}

export function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" style={{ marginBlockStart: 10, marginBlockEnd: 0, fontSize: 12, color: "#b73a3a" }}>
      {message}
    </p>
  );
}
