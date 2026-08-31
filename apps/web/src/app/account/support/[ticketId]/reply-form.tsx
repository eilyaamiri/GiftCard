"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage, Label, Textarea } from "@barat/ui";
import { api, ApiClientError } from "@/lib/api";

export function ReplyForm({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (message.trim().length < 3) {
      setError("متن پیام باید حداقل ۳ نویسه باشد.");
      return;
    }

    setSending(true);
    try {
      await api.replySupportRequest(ticketId, message.trim());
      setMessage("");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "ارسال پیام ممکن نشد. دوباره تلاش کنید.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="card pad" onSubmit={submit} noValidate>
      <div className="field">
        <Label htmlFor="reply" required>پاسخ شما</Label>
        <Textarea
          id="reply"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={2000}
          placeholder="پاسخ خود را بنویسید..."
          invalid={Boolean(error)}
        />
      </div>
      <FormMessage tone="error">{error}</FormMessage>
      <button type="submit" className="btn btn-primary" disabled={sending}>
        {sending ? "در حال ارسال..." : "ارسال پاسخ"}
      </button>
    </form>
  );
}
