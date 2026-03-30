const { createClient } = require("redis");
const dotenv = require("dotenv");
dotenv.config();

const redisClient = createClient({
  url: process.env.UPSTASH_REDIS_REST_URL,
  socket: {
    // Auto-reconnect with exponential backoff
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error("Redis: Max reconnect attempts reached");
        return new Error("Max retries reached");
      }
      const delay = Math.min(retries * 500, 5000);
      console.log(`Redis: Reconnecting in ${delay}ms (attempt ${retries})`);
      return delay;
    },
    connectTimeout: 10000,
  },
});

redisClient.on("error", (err) => {
  console.error("Redis Error:", err.message);
});

redisClient.on("reconnecting", () => {
  console.log("Redis: Reconnecting...");
});

redisClient.on("ready", () => {
  console.log("Redis: Ready");
});

async function connectRedis() {
  try {
    await redisClient.connect();
    console.log("✅ Redis connected");
  } catch (err) {
    console.error("❌ Failed to connect Redis:", err.message);
    // Don't crash — server can still handle requests, Redis will auto-reconnect
  }
}

module.exports = { redisClient, connectRedis };