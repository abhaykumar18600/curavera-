import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import uploadRoutes from "./routes/upload.js";

import { connectDB } from "./config/db.js";
import appointmentRoutes from "./routes/appointmentRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import authRoutes, { ensureBootstrapAdmin } from "./routes/authRoutes.js";
import { requireSession } from "./middleware/sessionAuth.js";

const app = express();
const PORT = Number(process.env.PORT) || 5000;

const allowedOrigins = (process.env.CLIENT_URL || "http://127.0.0.1:5500,http://localhost:5500")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(helmet());

app.use(cors({
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  credentials: true,
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Origin is not allowed by CORS."));
  }
}));

app.use(express.json({ limit: "10kb" }));

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Curavera appointment API is running"
  });
});

// Rate limiter
const appointmentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many appointment requests. Please try again later."
  }
});

// Public appointment routes
app.use("/api/appointments", appointmentLimiter, appointmentRoutes);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => req.path !== "/login" && req.path !== "/signup",
  message: { success: false, message: "Too many login or signup attempts. Please try again later." }
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/admin/appointments", requireSession, adminRoutes);

// Cloudinary upload routes
app.use("/api/upload", requireSession, uploadRoutes);

// 404 handler - ALWAYS LAST
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found."
  });
});

// Global error handler
app.use((error, req, res, next) => {
  if (error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      success: false,
      message: "The attached report must be 10 MB or smaller."
    });
  }
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({
      success: false,
      message: "The request body is invalid."
    });
  }
  if (error.message === "Origin is not allowed by CORS.") {
    return res.status(403).json({
      success: false,
      message: "This frontend origin is not allowed."
    });
  }
  if (error.message === "Upload a PDF, JPG, PNG or WEBP report.") {
    return res.status(400).json({ success: false, message: error.message });
  }

  console.error("Server error:", error);

  return res.status(500).json({
    success: false,
    message: "Internal server error."
  });
});

async function startServer() {
  try {
    await connectDB();
    await ensureBootstrapAdmin();
    app.listen(PORT, () => {
      console.log(`Curavera API running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Could not start backend:", error.message);
    process.exit(1);
  }
}

startServer();