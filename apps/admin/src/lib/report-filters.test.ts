import { describe, expect, it } from "vitest";
import { orderSummaryDtoSchema, type OrderSummaryDto } from "@barat/contracts";
import { filterReportOrders, readReportFilters } from "./report-filters";

const NOW = new Date("2026-08-31T12:00:00.000Z").getTime();

function order(createdAt: string, status: OrderSummaryDto["status"] = "PAID"): OrderSummaryDto {
  return orderSummaryDtoSchema.parse({
    id: createdAt,
    orderNumber: `ORD-${createdAt}`,
    status,
    totalAmountIrr: "1000",
    displayAmountToman: "100",
    currency: "IRR",
    itemTitleFa: "گیفت کارت اپل",
    createdAt,
    paidAt: status === "PAID" ? createdAt : null,
    fulfilledAt: null,
  });
}

describe("report filters", () => {
  it("defaults to seven Tehran calendar days", () => {
    const filters = readReportFilters({}, NOW);
    expect(filters.from).toBe("2026-08-25");
    expect(filters.to).toBe("2026-08-31");
  });

  it("uses an exclusive Tehran-midnight upper boundary", () => {
    const filters = readReportFilters({ from: "2026-08-31", to: "2026-08-31" }, NOW);
    const result = filterReportOrders([
      order("2026-08-30T20:29:59.999Z"),
      order("2026-08-30T20:30:00.000Z"),
      order("2026-08-31T20:29:59.999Z"),
      order("2026-08-31T20:30:00.000Z"),
    ], filters);
    expect(result.map((item) => item.createdAt)).toEqual([
      "2026-08-30T20:30:00.000Z",
      "2026-08-31T20:29:59.999Z",
    ]);
  });

  it("normalizes a reversed range and rejects impossible dates", () => {
    const reversed = readReportFilters({ from: "2026-08-31", to: "2026-08-20" }, NOW);
    expect(reversed.from).toBe("2026-08-20");
    expect(reversed.to).toBe("2026-08-31");
    const invalid = readReportFilters({ from: "2026-02-30", to: "not-a-date" }, NOW);
    expect(invalid.from).toBe("2026-08-25");
    expect(invalid.to).toBe("2026-08-31");
  });

  it("applies status and Persian service filters", () => {
    const filters = readReportFilters({ from: "2026-08-31", to: "2026-08-31", status: "FAILED", service: "اپل" }, NOW);
    const result = filterReportOrders([
      order("2026-08-31T10:00:00.000Z", "PAID"),
      order("2026-08-31T10:00:01.000Z", "FAILED"),
    ], filters);
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("FAILED");
  });

  it("caps oversized ranges at 366 inclusive calendar days", () => {
    const filters = readReportFilters({ from: "2020-01-01", to: "2026-08-31" }, NOW);
    expect((filters.toExclusiveMs - filters.fromMs) / 86_400_000).toBe(366);
  });
});
