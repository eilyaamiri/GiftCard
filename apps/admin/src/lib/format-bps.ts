import { toPersianDigits } from "@barat/ui";

/** Renders integer basis points as a percentage string, e.g. 150 -> "۱٫۵٪". Never use a float for the bps value itself. */
export function formatBps(bps: number): string {
  const percent = (bps / 100).toFixed(bps % 100 === 0 ? 0 : 1);
  return `${toPersianDigits(percent.replace(".", "٫"))}٪`;
}
