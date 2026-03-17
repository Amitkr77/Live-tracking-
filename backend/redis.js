const { createClient } = require("redis");
const dotenv =require("dotenv")
dotenv.config()

const redisClient = createClient({
  url: process.env.UPSTASH_REDIS_REST_URL
});

redisClient.on("error", (err) => {
  console.log("Redis Error:", err);
});

async function connectRedis() {
  try {
    await redisClient.connect();
    console.log("Redis connected");
  } catch (err) {
    console.log("Failed to connect Redis:", err);
  }
}

module.exports = { redisClient, connectRedis };