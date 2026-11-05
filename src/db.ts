import mongoose from "mongoose";
import { MongoClient } from "mongodb";

const mongoUri = process.env.MONGODB_URI ?? "";

if (!mongoUri) {
  throw new Error("MONGODB_URI must be set.");
}

export const mongoClient = new MongoClient(mongoUri);

export const databaseName =
  process.env.MONGODB_DATABASE ?? "studiospace";

export async function connectDatabase(): Promise<void> {
  await mongoose.connect(mongoUri, {
    dbName: databaseName,
  });

  await mongoClient.connect();
}

export function getDatabase() {
  return mongoClient.db(databaseName);
}