const { createClient } = require("redis");

const redisClient = createClient({
  url: process.env.UPSTASH_REDIS_REST_URL
});

redisClient.on("error", (err) => {
  console.log("Redis Error:", err);
});

async function connectRedis(){
  await redisClient.connect();
  console.log("Redis connected");
}

module.exports = { redisClient, connectRedis };