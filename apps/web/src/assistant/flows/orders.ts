import { go, opt, stay, type StateDef } from "../engine/machine";
import { authGate } from "./common";

export const orderStates: Record<string, StateDef> = {
  "orders.list": {
    id: "orders.list",
    flow: "orderTracking",
    failMessage: "نتونستم سفارش‌هات رو بگیرم.",
    track: "orders_viewed",
    guard: (ctx) => authGate("orders.list", ctx),
    on: {
      VIEW_ORDER: async (_ctx, orderNumber) =>
        orderNumber === undefined ? stay("این سفارش پیدا نشد.") : go("orders.detail", { patch: { selectedOrder: orderNumber } }),
    },
    render: async (ctx) => {
      const orders = (await ctx.services.orders.list()).slice(0, 10);
      if (orders.length === 0) return { message: "هنوز سفارشی ثبت نکردید." };
      return {
        message: "سفارش‌های اخیر شما:",
        options: orders.map((o) =>
          opt(o.id, `سفارش ${o.orderNumber}`, "VIEW_ORDER", o.orderNumber, {
            description: `${o.statusLabel} · ${o.totalLabel} · ${o.createdLabel}`,
          }),
        ),
      };
    },
  },

  "orders.detail": {
    id: "orders.detail",
    flow: "orderTracking",
    failMessage: "نتونستم جزئیات سفارش رو بگیرم.",
    guard: async (ctx) => {
      const gate = await authGate("orders.detail", ctx);
      if (gate !== null) return gate;
      const number = ctx.data.selectedOrder;
      const order = number === undefined ? null : await ctx.memo(`order:${number}`, () => ctx.services.orders.get(number));
      return order === null
        ? go("orders.list", {
            patch: { selectedOrder: undefined },
            notice: { text: "این سفارش پیدا نشد.", tone: "error" },
            history: "none",
          })
        : null;
    },
    on: {
      SELECT: async (ctx, value) => {
        const number = ctx.data.selectedOrder;
        if (value !== "open" || number === undefined) return stay("این گزینه معتبر نیست.");
        return go("orders.detail", {
          effect: { type: "navigate", path: `/orders/${encodeURIComponent(number)}` },
          history: "none",
        });
      },
      CONTACT_SUPPORT: async (ctx) => {
        const number = ctx.data.selectedOrder;
        const order = number === undefined ? null : await ctx.memo(`order:${number}`, () => ctx.services.orders.get(number));
        if (order === null) return stay("این سفارش پیدا نشد.");
        return go("ticket.subject", { patch: { ticket: { orderId: order.id, orderNumber: order.orderNumber } } });
      },
    },
    render: async (ctx) => {
      const number = ctx.data.selectedOrder ?? "";
      const order = await ctx.memo(`order:${number}`, () => ctx.services.orders.get(number));
      return {
        message: `جزئیات سفارش ${number}`,
        blocks:
          order === null
            ? []
            : [
                {
                  kind: "summary",
                  title: `سفارش ${order.orderNumber}`,
                  lines: [
                    { label: "وضعیت", value: order.statusLabel },
                    { label: "مبلغ", value: order.totalLabel },
                    { label: "تاریخ ثبت", value: order.createdLabel },
                  ],
                },
              ],
        options: [
          opt("open", "مشاهده جزئیات", "SELECT", "open", { variant: "primary" }),
          opt("support", "پشتیبانی این سفارش", "CONTACT_SUPPORT"),
        ],
      };
    },
  },
};
