import type { Metadata } from "next";
import { getTelegramProduct } from "@/lib/telegram";
import { TelegramOrderPage } from "../_components/telegram-order-page";

export const metadata: Metadata = {
  title: "خرید استارز تلگرام | برات",
  description: "بسته استارز تلگرام را انتخاب کنید و نام کاربری حساب‌تان را وارد کنید؛ قیمت ریالی پیش از پرداخت نمایش داده می‌شود.",
};

/**
 * Stars.
 *
 * The slug is looked up rather than hard-coded: the catalogue is seeded by the
 * API, and a page that depended on one exact slug would break the day the seed
 * changes. `getTelegramProduct` finds the Stars entry by its SKU and rejects
 * anything that turns out to be Premium.
 */
export default async function TelegramStarsPage() {
  const entry = await getTelegramProduct("stars");
  return <TelegramOrderPage entry={entry} product="stars" />;
}
