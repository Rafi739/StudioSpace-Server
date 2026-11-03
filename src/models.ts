import mongoose, { Schema } from "mongoose";
import type { BookingStatus, StudioCategory } from "./types.js";

export interface StudioDocument {
  title: string;
  category: StudioCategory;
  description: string;
  images: string[];
  hourlyRate: number;
  securityDeposit: number;
  location: string;
  capacity: number;
  amenities: string[];
  hostId: string;
  hostName: string;
  rating: number;
  reviewCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const studioSchema = new Schema<StudioDocument>({
  title: { type: String, required: true, trim: true, minlength: 3, maxlength: 100 },
  category: { type: String, required: true, enum: ["Photo Studio", "Podcast Room", "Sound Stage", "Music Studio", "Art Workshop"] },
  description: { type: String, required: true, trim: true, minlength: 20, maxlength: 3000 },
  images: { type: [String], default: [], validate: (values: string[]) => values.length <= 12 },
  hourlyRate: { type: Number, required: true, min: 1, max: 10000 },
  securityDeposit: { type: Number, default: 0, min: 0, max: 100000 },
  location: { type: String, required: true, trim: true, maxlength: 140 },
  capacity: { type: Number, required: true, min: 1, max: 500 },
  amenities: { type: [String], default: [] },
  hostId: { type: String, required: true, index: true },
  hostName: { type: String, default: "StudioSpace host", trim: true },
  rating: { type: Number, default: 0, min: 0, max: 5 },
  reviewCount: { type: Number, default: 0, min: 0 },
}, { timestamps: true, versionKey: false });

studioSchema.index({ title: "text", description: "text", location: "text" });

export interface BookingDocument {
  userId: string;
  studioId: mongoose.Types.ObjectId;
  hostId: string;
  studioTitle: string;
  image: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  totalPrice: number;
  status: BookingStatus;
  createdAt: Date;
}

const bookingSchema = new Schema<BookingDocument>({
  userId: { type: String, required: true, index: true },
  studioId: { type: Schema.Types.ObjectId, ref: "Studio", required: true },
  hostId: { type: String, required: true, index: true },
  studioTitle: { type: String, required: true },
  image: { type: String, default: "" },
  bookingDate: { type: String, required: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  totalPrice: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ["pending", "confirmed", "completed", "cancelled"], default: "pending" },
}, { timestamps: true, versionKey: false });

bookingSchema.index({ studioId: 1, bookingDate: 1, status: 1, startTime: 1, endTime: 1 });

export const StudioModel = mongoose.models.Studio ?? mongoose.model<StudioDocument>("Studio", studioSchema);
export const BookingModel = mongoose.models.Booking ?? mongoose.model<BookingDocument>("Booking", bookingSchema);

export interface ReviewDocument {
  studioId: mongoose.Types.ObjectId;
  userId: string;
  userName: string;
  rating: number;
  comment: string;
  createdAt: Date;
}

const reviewSchema = new Schema<ReviewDocument>({
  studioId: { type: Schema.Types.ObjectId, ref: "Studio", required: true, index: true },
  userId: { type: String, required: true },
  userName: { type: String, required: true, trim: true },
  rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
  comment: { type: String, required: true, trim: true, minlength: 3, maxlength: 1000 },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

reviewSchema.index({ studioId: 1, userId: 1 }, { unique: true });

export const ReviewModel = mongoose.models.Review ?? mongoose.model<ReviewDocument>("Review", reviewSchema);

const newsletterSchema = new Schema<{ email: string; createdAt: Date }>({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

export const NewsletterModel = mongoose.models.Newsletter ?? mongoose.model("Newsletter", newsletterSchema);
