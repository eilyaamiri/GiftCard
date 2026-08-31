import { z } from "zod";
import { isoDateTimeSchema } from "@barat/contracts";
import { api } from "@/lib/api";

const nullableDate = isoDateTimeSchema.nullable();

export const supportMessageSchema = z.object({
  id: z.string().min(1),
  authorType: z.enum(["CUSTOMER", "STAFF"]),
  authorName: z.string(),
  body: z.string(),
  createdAt: isoDateTimeSchema,
});

export const supportOwnershipSchema = z.object({
  id: z.string().min(1),
  previousOwnerName: z.string().nullable(),
  newOwnerName: z.string(),
  changedByName: z.string(),
  reason: z.string(),
  createdAt: isoDateTimeSchema,
});

export const supportTicketSchema = z.object({
  id: z.string().min(1),
  workItemId: z.string().min(1),
  code: z.string(),
  subject: z.string(),
  status: z.string(),
  customerId: z.string(),
  customerName: z.string().nullable(),
  customerCode: z.string(),
  orderId: z.string().nullable(),
  orderNumber: z.string().nullable(),
  ownerStaffId: z.string().nullable(),
  ownerStaffName: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  firstResponseDueAt: isoDateTimeSchema,
  nextResponseDueAt: isoDateTimeSchema,
  firstRespondedAt: nullableDate,
  lastRespondedAt: nullableDate,
  firstResponseBreached: z.boolean(),
  responseBreached: z.boolean(),
  resolutionNote: z.string().nullable(),
  messages: z.array(supportMessageSchema),
  ownershipHistory: z.array(supportOwnershipSchema),
});

export type SupportTicket = z.infer<typeof supportTicketSchema>;

export const supportTickets = {
  list: () => api.get("/api/support/tickets", z.array(supportTicketSchema)),
  get: (ticketId: string) => api.get(`/api/support/tickets/${encodeURIComponent(ticketId)}`, supportTicketSchema),
  reply: (ticketId: string, message: string) => api.post(`/api/support/tickets/${encodeURIComponent(ticketId)}/messages`, { message }, supportTicketSchema),
  close: (ticketId: string, resolutionNote: string) => api.post(`/api/support/tickets/${encodeURIComponent(ticketId)}/close`, { resolutionNote }, supportTicketSchema),
};
