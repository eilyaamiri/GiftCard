import type { Metadata } from "next";
import { getTelegramProduct } from "@/lib/telegram";
import { TelegramOrderPage } from "../_components/telegram-order-page";

export const metadata: Metadata = {
  title: "خرید پرمیوم تلگرام | برات",
  description: "اشتراک پرمیوم تلگرام را برای ۳، ۶ یا ۱۲ ماه سفارش دهید؛ قیمت ریالی پیش از پرداخت نمایش داده می‌شود.",
};

/** Premium. Same lookup rule as Stars; see that page for why none of these
 * slugs are written down here. */
export default async function TelegramPremiumPage() {
  const entry = await getTelegramProduct("premium");
  return <TelegramOrderPage entry={entry} product="premium" />;
}
