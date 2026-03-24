


const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { redisClient, connectRedis } = require("./redis");

const app = express();
app.use(cors());
app.use(express.json());

connectRedis();

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

// START TRIP
app.post("/trip/start", async (req, res) => {
  const { tripId, driverId, customerLat, customerLng } = req.body;

  if (!customerLat || !customerLng) {
    return res.status(400).json({ error: "Customer location required" });
  }
  await redisClient.set(
    `trip:${tripId}`,
    JSON.stringify({
      driverId,
      customerLocation: {
        lat: customerLat,
        lng: customerLng
      },
      status: "active"
    })
  ); res.json({ success: true, message: "Trip started", tripId });
});

// STOP TRIP
app.post("/trip/stop", async (req, res) => {

  const { tripId, driverId } = req.body;

  await redisClient.del(`driver:${driverId}:location`);

  io.to(`trip:${tripId}`).emit("trip_stopped");

  res.json({
    success: true,
    message: "Trip stopped"
  });

});

// SOCKET
io.on("connection", (socket) => {

  console.log("Client connected:", socket.id);

  // join trip
  socket.on("join_trip", async ({ tripId, driverId }) => {

    socket.join(`trip:${tripId}`);

    // 🔥 GET TRIP DATA
    const tripData = await redisClient.get(`trip:${tripId}`);

    if (tripData) {
      const trip = JSON.parse(tripData);

      // ✅ Send full trip info (IMPORTANT)
      socket.emit("trip_data", {
        customerLocation: trip.customerLocation
      });
    }

    const location = await redisClient.get(`driver:${driverId}:location`);

    if (location) {

      const parsed = JSON.parse(location);
      socket.emit("receive_location", parsed);

    }

    console.log(`Joined trip:${tripId}`);

  });

  // driver location update
  socket.on("location_update", async (data) => {

    const { tripId, driverId, lat, lng } = data;

    const tripData = await redisClient.get(`trip:${tripId}`);
    if (!tripData) return;
    const trip = JSON.parse(tripData);
    if (trip.driverId !== driverId) return;

    console.log("Location received:", lat, lng);

    await redisClient.set(
      `driver:${driverId}:location`,
      JSON.stringify({
        lat,
        lng,
        timestamp: Date.now()
      }), { EX: 3600 }
    );

    io.to(`trip:${tripId}`).emit("receive_location", {
      lat,
      lng
    });

  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });

});

server.listen(5000, () => {
  console.log("Server running on port 5000");
});
