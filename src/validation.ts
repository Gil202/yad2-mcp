import { z } from 'zod';

const timestamp = z.string().refine(v => Number.isFinite(Date.parse(v)), 'Invalid timestamp')
  .transform(v => new Date(v).toISOString());
const number = z.number().finite().nonnegative();
const optionalText = z.string().nullish().transform(v => v ?? undefined);
export const ingestSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1), title: z.string().min(1), type: z.enum(['rent', 'sale']),
    city: z.string().trim().min(1), neighborhood: optionalText, address: optionalText,
    price: number, rooms: number, floor: z.number().int().nullable().optional(),
    square_meters: number.nullable().optional(), description: optionalText,
    url: z.string().url().refine(v => {
      const u = new URL(v);
      return u.protocol === 'https:' && ['www.yad2.co.il', 'yad2.co.il'].includes(u.hostname) && !u.username && !u.password;
    }, 'Expected a Yad2 HTTPS URL'),
    images: z.array(z.string()).default([]), attributes: z.record(z.boolean()).default({}),
    contact_name: optionalText, contact_phone: optionalText,
    scraped_at: timestamp, updated_at: timestamp,
  })).max(10000),
  purge_previous: z.literal(false).optional(),
  log: z.object({ status: z.string(), rent_count: number.int(), sale_count: number.int(), message: z.string().optional() }).optional(),
});
