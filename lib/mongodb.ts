import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI ?? "";

if (uri.length === 0) {
  throw new Error("Missing MONGODB_URI environment variable");
}

declare global {
  var __truthLensMongoClient: MongoClient | undefined;
}

export async function connectToDatabase() {
  const cachedClient = global.__truthLensMongoClient;
  if (cachedClient) {
    return cachedClient;
  }

  const client = new MongoClient(uri);
  await client.connect();
  global.__truthLensMongoClient = client;

  return client;
}