import { checkText } from "../validators";
import { go, opt, stay, type StateDef } from "../engine/machine";
import { TEXT, authGate } from "./common";

export const supportStates: Record<string, StateDef> = {
  "support.menu": {
    id: "support.menu",
    flow: "support",
    failMessage: TEXT.loadFailed,
    track: "support_opened",
    on: {
      SELECT: async (_ctx, value) =>
        value === "ticket"
          ? go("ticket.subject", { patch: { ticket: {} } })
          : value === "orders"
            ? go("orders.list")
            : stay("این گزینه معتبر نیست."),
    },
    render: async (ctx) => {
      const channels = await ctx.memo("support:channels", () => ctx.services.support.channels());
      const direct = channels
        .filter((c) => c.kind !== "TICKET")
        .map((c) => opt(c.kind, c.title, "CONTACT_SUPPORT", c.kind, { description: c.description, href: c.href }));
      const ticket = channels.some((c) => c.kind === "TICKET")
        ? [opt("ticket", "✉️ ثبت تیکت پشتیبانی", "SELECT", "ticket")]
        : [];
      return {
        message: "چطور می‌تونیم کمکتون کنیم؟",
        options: [...direct, ...ticket, opt("orders", "📦 پیگیری سفارش", "SELECT", "orders")],
      };
    },
  },

  "ticket.subject": {
    id: "ticket.subject",
    flow: "ticket",
    guard: (ctx) => authGate("ticket.subject", ctx),
    on: {
      SUBMIT: async (ctx, raw) => {
        const checked = checkText(raw ?? "", 3, 120, "موضوع");
        return "error" in checked
          ? stay(checked.error)
          : go("ticket.message", { patch: { ticket: { ...ctx.data.ticket, subject: checked.value } } });
      },
    },
    render: async (ctx) => ({
      message:
        ctx.data.ticket?.orderNumber === undefined
          ? "موضوع پیامتون چیه؟"
          : `موضوع پیامتون دربارهٔ سفارش ${ctx.data.ticket.orderNumber} چیه؟`,
      input: { type: "text", action: "SUBMIT", placeholder: "موضوع", maxLength: 120 },
    }),
  },

  "ticket.message": {
    id: "ticket.message",
    flow: "ticket",
    failMessage: "نتونستم پیام رو ثبت کنم.",
    on: {
      SUBMIT: async (ctx, raw) => {
        const checked = checkText(raw ?? "", 3, 2000, "پیام");
        if ("error" in checked) return stay(checked.error);
        const ticket = ctx.data.ticket ?? {};
        const created = await ctx.services.support.createTicket({
          ...(ticket.orderId === undefined ? {} : { orderId: ticket.orderId }),
          subject: ticket.subject ?? "پیام به پشتیبانی",
          message: checked.value,
        });
        ctx.services.analytics.track("ticket_created", { service: ctx.data.serviceType ?? "none" });
        return go("ticket.done", { patch: { ticket: { ...ticket, reference: created.reference } }, history: "none" });
      },
    },
    render: async () => ({
      message: "پیامتون رو بنویسید.",
      input: { type: "textarea", action: "SUBMIT", placeholder: "پیام", maxLength: 2000 },
    }),
  },

  "ticket.done": {
    id: "ticket.done",
    flow: "ticket",
    nav: { back: false },
    on: { SELECT: async (_ctx, value) => (value === "orders" ? go("orders.list") : stay("این گزینه معتبر نیست.")) },
    render: async (ctx) => ({
      message: `پیامتون ثبت شد. کد پیگیری: ${ctx.data.ticket?.reference ?? ""}`,
      options: [opt("orders", "📦 سفارش‌های من", "SELECT", "orders")],
    }),
  },
};
