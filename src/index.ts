import "dotenv/config";
import cors from "cors";
import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { MongoServerError } from "mongodb";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { z } from "zod";
import { auth } from "./auth.js";
import { connectDatabase } from "./db.js";
import { BookingModel, NewsletterModel, ReviewModel, StudioModel } from "./models.js";
import { bookingInputSchema, newsletterSchema, profileUpdateSchema, reviewInputSchema, studioInputSchema, studioUpdateSchema } from "./validation.js";
import type { BookingStatus, SessionUser } from "./types.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const uploadDirectory = path.resolve(process.env.UPLOAD_DIRECTORY ?? "uploads");
const imgbbApiKey = process.env.IMGBB_API_KEY;
const imgbbResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z.object({ url: z.string().url() }).optional(),
  error: z.object({ message: z.string() }).optional(),
});
const imageUpload = multer({
  storage: imgbbApiKey ? multer.memoryStorage() : multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadDirectory),
    filename: (_req, file, callback) => {
      const extension = file.mimetype === "image/png" ? ".png" :
        file.mimetype === "image/webp" ? ".webp" : ".jpg";
      callback(null, `${randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      callback(new Error("Upload a JPG, PNG, or WebP image."));
      return;
    }
    callback(null, true);
  },
});

app.use(cors({
  origin: process.env.CLIENT_URL ?? "http://localhost:3000",
  credentials: true,
}));
app.all(/^\/api\/auth\/.*/, toNodeHandler(auth));
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(uploadDirectory, { dotfiles: "deny", index: false }));

async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) {
      res.status(401).json({ error: "Please sign in to continue." });
      return;
    }
    req.user = {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image,
    };
    next();
  } catch (error) {
    next(error);
  }
}

function currentUser(req: Request): SessionUser {
  if (!req.user) throw new Error("Authenticated user was not attached to the request.");
  return req.user;
}

function serializeStudio(studio: InstanceType<typeof StudioModel>) {
  return {
    id: studio._id.toString(),
    title: studio.title,
    category: studio.category,
    description: studio.description,
    images: studio.images,
    hourlyRate: studio.hourlyRate,
    securityDeposit: studio.securityDeposit,
    location: studio.location,
    capacity: studio.capacity,
    amenities: studio.amenities,
    hostId: studio.hostId,
    hostName: studio.hostName || "StudioSpace host",
    rating: studio.rating,
    reviewCount: studio.reviewCount,
    createdAt: studio.createdAt.toISOString(),
  };
}

function serializeBooking(booking: InstanceType<typeof BookingModel>) {
  return {
    id: booking._id.toString(),
    studioId: booking.studioId.toString(),
    studioTitle: booking.studioTitle,
    image: booking.image,
    bookingDate: booking.bookingDate,
    startTime: booking.startTime,
    endTime: booking.endTime,
    totalPrice: booking.totalPrice,
    status: booking.status,
  };
}

function serializeReview(review: InstanceType<typeof ReviewModel>) {
  return {
    id: review._id.toString(),
    userName: review.userName,
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt.toISOString(),
  };
}

function sendValidationError(res: Response, issues: string[]): void {
  res.status(400).json({ error: issues.join(" ") });
}

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/newsletter", async (req, res, next) => {
  try {
    const result = newsletterSchema.safeParse(req.body);
    if (!result.success) { sendValidationError(res, result.error.issues.map((issue) => issue.message)); return; }
    await NewsletterModel.updateOne(
      { email: result.data.email.toLowerCase() },
      { $setOnInsert: { email: result.data.email.toLowerCase() } },
      { upsert: true },
    );
    res.status(200).json({ success: true });
  } catch (error) { next(error); }
});

app.post("/api/uploads/images", authenticate, (req, res, next) => {
  imageUpload.single("image")(req, res, async (error: unknown) => {
    if (error) { next(error); return; }
    if (!req.file) { res.status(400).json({ error: "Choose an image to upload." }); return; }
    if (imgbbApiKey) {
      try {
        const formData = new FormData();
        formData.set("image", req.file.buffer.toString("base64"));
        const response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(imgbbApiKey)}`, {
          method: "POST",
          body: formData,
        });
        const payload: unknown = await response.json().catch(() => null);
        const result = imgbbResponseSchema.safeParse(payload);
        if (!response.ok || !result.success || !result.data.success || !result.data.data) {
          const message = result.success
            ? result.data.error?.message ?? "The image host could not upload this file."
            : "The image host returned an invalid response.";
          res.status(502).json({ error: message });
          return;
        }
        res.status(201).json({ url: result.data.data.url });
      } catch (uploadError) {
        next(uploadError);
      }
      return;
    }
    const origin = process.env.BETTER_AUTH_URL ?? `http://localhost:${port}`;
    res.status(201).json({ url: `${origin}/uploads/${encodeURIComponent(req.file.filename)}` });
  });
});

app.get("/api/studios/mine", authenticate, async (req, res, next) => {
  try {
    const studios = await StudioModel.find({ hostId: currentUser(req).id }).sort({ createdAt: -1 });
    res.json({ studios: studios.map(serializeStudio) });
  } catch (error) { next(error); }
});

app.get("/api/studios", async (req, res, next) => {
  try {
    const filter: Record<string, unknown> = {};
    if (typeof req.query.category === "string" && req.query.category !== "All categories") {
      filter.category = req.query.category;
    }
    if (typeof req.query.search === "string" && req.query.search.trim()) {
      const escaped = req.query.search.trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { title: { $regex: escaped, $options: "i" } },
        { location: { $regex: escaped, $options: "i" } },
      ];
    }
    const sortKey = req.query.sort === "price-low" ? "hourlyRate" :
      req.query.sort === "price-high" ? "-hourlyRate" : "-rating";
    const requestedLimit = Number(req.query.limit);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 100)
      : 50;
    const studios = await StudioModel.find(filter).sort(sortKey).limit(limit);
    res.json({ studios: studios.map(serializeStudio) });
  } catch (error) { next(error); }
});

app.get("/api/studios/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) { res.status(400).json({ error: "Invalid studio ID." }); return; }
    const studio = await StudioModel.findById(req.params.id);
    if (!studio) { res.status(404).json({ error: "Studio not found." }); return; }
    res.json({ studio: serializeStudio(studio) });
  } catch (error) { next(error); }
});

app.get("/api/studios/:id/reviews", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) { res.status(400).json({ error: "Invalid studio ID." }); return; }
    const studioExists = await StudioModel.exists({ _id: req.params.id });
    if (!studioExists) { res.status(404).json({ error: "Studio not found." }); return; }
    const [reviews, session] = await Promise.all([
      ReviewModel.find({ studioId: req.params.id }).sort({ createdAt: -1 }).limit(100),
      auth.api.getSession({ headers: fromNodeHeaders(req.headers) }),
    ]);
    const hasReviewed = session
      ? Boolean(await ReviewModel.exists({ studioId: req.params.id, userId: session.user.id }))
      : false;
    res.json({ reviews: reviews.map(serializeReview), hasReviewed });
  } catch (error) { next(error); }
});

app.post("/api/studios/:id/reviews", authenticate, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) { res.status(400).json({ error: "Invalid studio ID." }); return; }
    const result = reviewInputSchema.safeParse(req.body);
    if (!result.success) { sendValidationError(res, result.error.issues.map((issue) => issue.message)); return; }

    const user = currentUser(req);
    const studio = await StudioModel.findById(req.params.id);
    if (!studio) { res.status(404).json({ error: "Studio not found." }); return; }
    if (studio.hostId === user.id) { res.status(403).json({ error: "You cannot review your own studio." }); return; }
    if (await ReviewModel.exists({ studioId: studio._id, userId: user.id })) {
      res.status(409).json({ error: "You have already reviewed this studio." }); return;
    }

    const review = await ReviewModel.create({
      studioId: studio._id,
      userId: user.id,
      userName: user.name,
      ...result.data,
    });
    const updatedStudio = await StudioModel.findOneAndUpdate(
      { _id: studio._id },
      [{
        $set: {
          rating: {
            $divide: [
              { $add: [{ $multiply: ["$rating", "$reviewCount"] }, result.data.rating] },
              { $add: ["$reviewCount", 1] },
            ],
          },
          reviewCount: { $add: ["$reviewCount", 1] },
        },
      }],
      { new: true },
    );
    if (!updatedStudio) {
      await ReviewModel.deleteOne({ _id: review._id });
      res.status(404).json({ error: "Studio not found." });
      return;
    }
    res.status(201).json({
      review: serializeReview(review),
      rating: updatedStudio.rating,
      reviewCount: updatedStudio.reviewCount,
    });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      res.status(409).json({ error: "You have already reviewed this studio." });
      return;
    }
    next(error);
  }
});

app.post("/api/studios", authenticate, async (req, res, next) => {
  try {
    const result = studioInputSchema.safeParse(req.body);
    if (!result.success) { sendValidationError(res, result.error.issues.map((issue) => issue.message)); return; }
    const user = currentUser(req);
    const studio = await StudioModel.create({
      ...result.data,
      hostId: user.id,
      hostName: user.name,
    });
    res.status(201).json({ studio: serializeStudio(studio) });
  } catch (error) { next(error); }
});

app.patch("/api/studios/:id", authenticate, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) { res.status(400).json({ error: "Invalid studio ID." }); return; }
    const result = studioUpdateSchema.safeParse(req.body);
    if (!result.success) { sendValidationError(res, result.error.issues.map((issue) => issue.message)); return; }
    if (!Object.keys(result.data).length) { res.status(400).json({ error: "Provide at least one field to update." }); return; }
    const studio = await StudioModel.findOneAndUpdate(
      { _id: req.params.id, hostId: currentUser(req).id },
      { $set: result.data },
      { new: true, runValidators: true },
    );
    if (!studio) { res.status(404).json({ error: "Studio not found or you do not own it." }); return; }
    res.json({ studio: serializeStudio(studio) });
  } catch (error) { next(error); }
});

app.delete("/api/studios/:id", authenticate, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) { res.status(400).json({ error: "Invalid studio ID." }); return; }
    const studio = await StudioModel.findOneAndDelete({ _id: req.params.id, hostId: currentUser(req).id });
    if (!studio) { res.status(404).json({ error: "Studio not found or you do not own it." }); return; }
    res.json({ success: true });
  } catch (error) { next(error); }
});

app.post("/api/bookings", authenticate, async (req, res, next) => {
  try {
    const result = bookingInputSchema.safeParse(req.body);
    if (!result.success) { sendValidationError(res, result.error.issues.map((issue) => issue.message)); return; }
    const { studioId, bookingDate, startTime, endTime } = result.data;
    const date = new Date(`${bookingDate}T00:00:00.000Z`);
    if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== bookingDate) {
      res.status(400).json({ error: "Choose a valid booking date." }); return;
    }
    const today = new Date().toISOString().slice(0, 10);
    if (bookingDate < today) { res.status(400).json({ error: "Booking dates must be today or later." }); return; }
    const startMinutes = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3));
    const endMinutes = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3));
    if (endMinutes <= startMinutes) { res.status(400).json({ error: "End time must be after start time." }); return; }

    const studio = await StudioModel.findById(studioId);
    if (!studio) { res.status(404).json({ error: "Studio not found." }); return; }
    const user = currentUser(req);
    if (studio.hostId === user.id) { res.status(400).json({ error: "You cannot book your own studio." }); return; }
    const existing = await BookingModel.findOne({
      studioId,
      bookingDate,
      status: { $in: ["pending", "confirmed"] },
      startTime: { $lt: endTime },
      endTime: { $gt: startTime },
    });
    if (existing) { res.status(409).json({ error: "This time overlaps an existing booking." }); return; }
    const totalPrice = Math.round(((endMinutes - startMinutes) / 60) * studio.hourlyRate * 100) / 100;
    const booking = await BookingModel.create({
      userId: user.id,
      studioId: studio._id,
      hostId: studio.hostId,
      studioTitle: studio.title,
      image: studio.images[0] ?? "",
      bookingDate,
      startTime,
      endTime,
      totalPrice,
      status: "pending",
    });
    res.status(201).json({ booking: serializeBooking(booking) });
  } catch (error) { next(error); }
});

app.get("/api/bookings/my", authenticate, async (req, res, next) => {
  try {
    const bookings = await BookingModel.find({ userId: currentUser(req).id }).sort({ createdAt: -1 });
    res.json({ bookings: bookings.map(serializeBooking) });
  } catch (error) { next(error); }
});

app.get("/api/bookings/host", authenticate, async (req, res, next) => {
  try {
    const bookings = await BookingModel.find({ hostId: currentUser(req).id }).sort({ createdAt: -1 });
    res.json({ bookings: bookings.map(serializeBooking) });
  } catch (error) { next(error); }
});

app.get("/api/bookings/:id", authenticate, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) { res.status(400).json({ error: "Invalid booking ID." }); return; }
    const userId = currentUser(req).id;
    const booking = await BookingModel.findOne({
      _id: req.params.id,
      $or: [{ userId }, { hostId: userId }],
    });
    if (!booking) { res.status(404).json({ error: "Booking not found." }); return; }
    res.json({ booking: serializeBooking(booking) });
  } catch (error) { next(error); }
});

app.patch("/api/bookings/:id/cancel", authenticate, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) { res.status(400).json({ error: "Invalid booking ID." }); return; }
    const booking = await BookingModel.findOne({ _id: req.params.id, userId: currentUser(req).id });
    if (!booking) { res.status(404).json({ error: "Booking not found." }); return; }
    if (booking.status !== "pending" && booking.status !== "confirmed") {
      res.status(409).json({ error: "Only pending or confirmed bookings can be cancelled." }); return;
    }
    booking.status = "cancelled";
    await booking.save();
    res.json({ booking: serializeBooking(booking) });
  } catch (error) { next(error); }
});

app.patch("/api/bookings/:id/status", authenticate, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) { res.status(400).json({ error: "Invalid booking ID." }); return; }
    const body = req.body as { status?: unknown };
    const allowed: BookingStatus[] = ["confirmed", "completed", "cancelled"];
    if (typeof body.status !== "string" || !allowed.includes(body.status as BookingStatus)) {
      res.status(400).json({ error: "Status must be confirmed, completed, or cancelled." }); return;
    }
    const booking = await BookingModel.findOne({ _id: req.params.id, hostId: currentUser(req).id });
    if (!booking) { res.status(404).json({ error: "Booking not found or you do not host it." }); return; }
    if (booking.status === "cancelled" || booking.status === "completed") {
      res.status(409).json({ error: "This booking can no longer be changed." }); return;
    }
    booking.status = body.status as BookingStatus;
    await booking.save();
    res.json({ booking: serializeBooking(booking) });
  } catch (error) { next(error); }
});

app.get("/api/dashboard", authenticate, async (req, res, next) => {
  try {
    const userId = currentUser(req).id;
    const [studioCount, bookings, earnings] = await Promise.all([
      StudioModel.countDocuments({ hostId: userId }),
      BookingModel.find({ hostId: userId }).sort({ createdAt: -1 }).limit(5),
      BookingModel.aggregate<{ total: number }>([
        { $match: { hostId: userId, status: { $in: ["confirmed", "completed"] } } },
        { $group: { _id: null, total: { $sum: "$totalPrice" } } },
      ]),
    ]);
    res.json({
      studioCount,
      bookingCount: await BookingModel.countDocuments({ hostId: userId }),
      earnings: earnings[0]?.total ?? 0,
      recentBookings: bookings.map(serializeBooking),
    });
  } catch (error) { next(error); }
});

app.patch("/api/users/me", authenticate, async (req, res, next) => {
  try {
    const result = profileUpdateSchema.safeParse(req.body);
    if (!result.success) { sendValidationError(res, result.error.issues.map((issue) => issue.message)); return; }
    const updated = await auth.api.updateUser({
      headers: fromNodeHeaders(req.headers),
      body: { name: result.data.name, ...(result.data.image ? { image: result.data.image } : {}) },
    });
    if (!updated.status) { res.status(404).json({ error: "Account could not be updated." }); return; }
    const refreshedSession = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!refreshedSession) { res.status(401).json({ error: "Your session expired. Please sign in again." }); return; }
    res.json({ user: { id: refreshedSession.user.id, name: refreshedSession.user.name, email: refreshedSession.user.email, image: refreshedSession.user.image } });
  } catch (error) { next(error); }
});

app.use((_req, res) => res.status(404).json({ error: "API route not found." }));

const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  console.error(error);
  if (error instanceof multer.MulterError) {
    res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      error: error.code === "LIMIT_FILE_SIZE" ? "Images must be smaller than 8 MB." : "Could not upload this image.",
    });
    return;
  }
  if (error instanceof Error && error.message === "Upload a JPG, PNG, or WebP image.") {
    res.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof mongoose.Error.ValidationError) {
    res.status(400).json({ error: "The submitted data is invalid." });
    return;
  }
  res.status(500).json({ error: "An unexpected server error occurred." });
};
app.use(errorHandler);

async function start(): Promise<void> {
  if (!imgbbApiKey) await mkdir(uploadDirectory, { recursive: true });
  await connectDatabase();
  app.listen(port, () => console.info(`StudioSpace API listening on port ${port}`));
}

start().catch((error: unknown) => {
  console.error("Could not start StudioSpace API.", error);
  process.exitCode = 1;
});
