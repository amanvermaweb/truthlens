import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI ?? "";
const appName = process.env.MONGODB_APP_NAME ?? "truth-lens";
const shouldForceIPv4 = process.env.MONGODB_FORCE_IPV4 === "true";
const maxConnectRetries = Number(process.env.MONGODB_CONNECT_RETRIES ?? "3");

if (uri.length === 0) {
  throw new Error("Missing MONGODB_URI environment variable");
}

declare global {
  var __truthLensMongoClient: MongoClient | undefined;
  var __truthLensMongoClientPromise: Promise<MongoClient> | undefined;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry(client: MongoClient) {
  const retries = Number.isFinite(maxConnectRetries) && maxConnectRetries > 0 ? maxConnectRetries : 1;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await client.connect();
      return client;
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }

      // Backoff avoids synchronized reconnect attempts during transient network/TLS issues.
      await wait(250 * attempt);
    }
  }

  return client;
}

export async function connectToDatabase() {
  const cachedClient = global.__truthLensMongoClient;
  if (cachedClient) {
    return cachedClient;
  }

  const cachedPromise = global.__truthLensMongoClientPromise;
  if (cachedPromise) {
    return cachedPromise;
  }

  const client = new MongoClient(uri, {
    appName,
    ...(shouldForceIPv4 ? { family: 4 } : {}),
  });

  const connectPromise = connectWithRetry(client)
    .then((connectedClient) => {
      global.__truthLensMongoClient = connectedClient;
      return connectedClient;
    })
    .catch((error) => {
      global.__truthLensMongoClientPromise = undefined;
      throw error;
    });

  global.__truthLensMongoClientPromise = connectPromise;

  return connectPromise;
}
