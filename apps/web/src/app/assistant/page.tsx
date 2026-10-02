import type { Metadata } from "next";
import { AssistantPanel } from "@/components/assistant/assistant-panel";

export const metadata: Metadata = {
  title: "دستیار خرید",
  description: "خرید گیفت‌کارت، استارز و پرمیوم تلگرام، شارژ بازی و پیگیری سفارش‌ها، قدم‌به‌قدم و در یک گفتگو.",
};

/**
 * The phone's assistant: the same conversation as the desktop widget, given a
 * page of its own because a floating panel is the wrong shape on a small
 * screen. The conversation itself lives in the browser session, so arriving
 * here after the widget (or the other way round) continues the same one.
 */
export default function AssistantPage() {
  return (
    <main className="asst-page">
      <AssistantPanel variant="page" returnPath="/assistant" />
    </main>
  );
}
