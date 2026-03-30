const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { redisClient, connectRedis } = require("./redis");

const app = express();
app.use(cors());
app.use(express.json());

// Connect Redis before starting server
connectRedis();

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
  // Prefer WebSocket for low-latency, fall back to polling
  transports: ["websocket", "polling"],
  // Ping interval & timeout tuned for mobile networks
  pingInterval: 10000,
  pingTimeout: 20000,
  // Allow max 1MB payload
  maxHttpBufferSize: 1e6,
});

// ─── Health Check ───────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// ─── START TRIP ─────────────────────────────────────────────
app.post("/trip/start", async (req, res) => {
  try {
    const { tripId, driverId, customerLat, customerLng } = req.body;

    if (!tripId || !driverId) {
      return res.status(400).json({ error: "tripId and driverId are required" });
    }

    if (!customerLat || !customerLng) {
      return res.status(400).json({ error: "Customer location required" });
    }

    const tripData = {
      driverId,
      customerLocation: {
        lat: parseFloat(customerLat),
        lng: parseFloat(customerLng),
      },
      status: "active",
      startedAt: Date.now(),
    };

    // Store trip with 24h TTL so stale trips auto-cleanup
    await redisClient.set(`trip:${tripId}`, JSON.stringify(tripData), {
      EX: 86400,
    });

    console.log(`✅ Trip ${tripId} started by ${driverId}`);
    res.json({ success: true, message: "Trip started", tripId });
  } catch (err) {
    console.error("Error starting trip:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── STOP TRIP ──────────────────────────────────────────────
app.post("/trip/stop", async (req, res) => {
  try {
    const { tripId, driverId } = req.body;

    if (!tripId || !driverId) {
      return res.status(400).json({ error: "tripId and driverId are required" });
    }

    // Clean up driver location and trip data
    await Promise.all([
      redisClient.del(`driver:${driverId}:location`),
      redisClient.del(`trip:${tripId}`),
    ]);

    io.to(`trip:${tripId}`).emit("trip_stopped");

    console.log(`🛑 Trip ${tripId} stopped`);
    res.json({ success: true, message: "Trip stopped" });
  } catch (err) {
    console.error("Error stopping trip:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── SOCKET.IO ──────────────────────────────────────────────

// Per-driver throttle map: driverId -> lastEmitTimestamp
const driverThrottles = new Map();
const THROTTLE_MS = 1500; // Min 1.5s between broadcasts

io.on("connection", (socket) => {
  console.log(`🔌 Connected: ${socket.id}`);

  // ── Join Trip ──
  socket.on("join_trip", async ({ tripId, driverId }) => {
    try {
      if (!tripId) return;

      socket.join(`trip:${tripId}`);

      // Send trip data (customer location)
      const tripData = await redisClient.get(`trip:${tripId}`);
      if (tripData) {
        const trip = JSON.parse(tripData);
        socket.emit("trip_data", {
          customerLocation: trip.customerLocation,
        });
      }

      // Send last known driver location
      if (driverId) {
        const location = await redisClient.get(`driver:${driverId}:location`);
        if (location) {
          socket.emit("receive_location", JSON.parse(location));
        }
      }

      console.log(`📍 ${socket.id} joined trip:${tripId}`);
    } catch (err) {
      console.error("Error joining trip:", err.message);
    }
  });

  // ── Location Update (from driver) ──
  socket.on("location_update", async (data) => {
    try {
      const { tripId, driverId, lat, lng } = data;
      if (!tripId || !driverId || lat == null || lng == null) return;

      // Validate coordinates
      const parsedLat = parseFloat(lat);
      const parsedLng = parseFloat(lng);
      if (isNaN(parsedLat) || isNaN(parsedLng)) return;
      if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) return;

      // Verify trip is active
      const tripData = await redisClient.get(`trip:${tripId}`);
      if (!tripData) return;

      const trip = JSON.parse(tripData);
      if (trip.driverId !== driverId) return;

      const locationPayload = {
        lat: parsedLat,
        lng: parsedLng,
        timestamp: Date.now(),
      };

      // Always save latest to Redis (cheap operation)
      await redisClient.set(
        `driver:${driverId}:location`,
        JSON.stringify(locationPayload),
        { EX: 3600 }
      );

      // Throttle broadcasts to clients (prevent flooding)
      const now = Date.now();
      const lastEmit = driverThrottles.get(driverId) || 0;

      if (now - lastEmit >= THROTTLE_MS) {
        driverThrottles.set(driverId, now);
        // Broadcast to all in the trip room (including sender for map sync)
        io.to(`trip:${tripId}`).emit("receive_location", {
          lat: parsedLat,
          lng: parsedLng,
        });
      }
    } catch (err) {
      console.error("Error processing location:", err.message);
    }
  });

  // ── Disconnect ──
  socket.on("disconnect", (reason) => {
    console.log(`❌ Disconnected: ${socket.id} (${reason})`);
  });
});

// ─── Start Server ───────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
