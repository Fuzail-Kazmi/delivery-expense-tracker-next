import { z } from "zod";
import { localDay } from "./ledger";
const amount = z.number().positive().max(9999999).multipleOf(0.01);
const common = {
  id: z.number().int().positive().optional(),
  notes: z.string().max(500).default(""),
  date: z.iso.date(),
};
const pastDate = z.iso
  .date()
  .refine((date) => date <= localDay(), "Use today or an earlier date.");
export const recordSchema = z.discriminatedUnion("type", [
  z.object({
    ...common,
    date: pastDate,
    type: z.literal("delivery"),
    price: amount,
    qty: z.number().int().min(1).max(10000),
  }),
  z.object({
    ...common,
    date: pastDate,
    type: z.literal("payment"),
    amount,
    method: z.enum(["Cash", "Easypaisa", "JazzCash", "Bank Transfer"]),
  }),
  z.object({ ...common, type: z.literal("price"), price: amount }),
]);
