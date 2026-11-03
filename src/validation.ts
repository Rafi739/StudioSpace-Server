import { z } from "zod";

const categorySchema = z.enum([
  "Photo Studio", "Podcast Room", "Sound Stage", "Music Studio", "Art Workshop",
]);

const imageSchema = z.string().url().refine((value) => value.startsWith("https://"), "Images must use HTTPS.");

export const studioInputSchema = z.object({
  title: z.string().trim().min(3).max(100),
  category: categorySchema,
  description: z.string().trim().min(20).max(3000),
  images: z.array(imageSchema).max(12),
  hourlyRate: z.number().min(1).max(10000),
  securityDeposit: z.number().min(0).max(100000),
  location: z.string().trim().min(2).max(140),
  capacity: z.number().int().min(1).max(500),
  amenities: z.array(z.string().trim().min(1).max(60)).max(30),
}).strict();

export const studioUpdateSchema = studioInputSchema.partial().strict();

export const bookingInputSchema = z.object({
  studioId: z.string().regex(/^[a-f\d]{24}$/i, "Invalid studio ID."),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM."),
  endTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM."),
}).strict();

export const reviewInputSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(3).max(1000),
}).strict();

export const profileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  image: z.union([imageSchema, z.literal("")]).optional(),
}).strict();

export const newsletterSchema = z.object({
  email: z.string().trim().email().max(254),
}).strict();
