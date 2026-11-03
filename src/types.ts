export type StudioCategory =
  | "Photo Studio"
  | "Podcast Room"
  | "Sound Stage"
  | "Music Studio"
  | "Art Workshop";

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}
