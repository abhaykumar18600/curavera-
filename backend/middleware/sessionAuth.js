import crypto from "crypto";
import DoctorAccount from "../models/DoctorAccount.js";
import DoctorSession from "../models/DoctorSession.js";

export const SESSION_COOKIE = "curavera_session";

export function getSessionToken(req) {
  const cookies = String(req.headers.cookie || "").split(";");
  const sessionCookie = cookies.find(cookie => cookie.trim().startsWith(`${SESSION_COOKIE}=`));
  if (!sessionCookie) return "";
  try {
    return decodeURIComponent(sessionCookie.trim().slice(SESSION_COOKIE.length + 1));
  } catch {
    return "";
  }
}

export async function requireSession(req, res, next) {
  try {
    const token = getSessionToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: "Please log in to continue." });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const session = await DoctorSession.findOne({
      tokenHash,
      expiresAt: { $gt: new Date() }
    }).lean();
    if (!session) {
      return res.status(401).json({ success: false, message: "Your session has expired. Please log in again." });
    }

    const doctor = await DoctorAccount.findById(session.doctor)
      .select("_id name email phone specialization photoUrl role status")
      .lean();
    if (!doctor || doctor.status !== "approved") {
      return res.status(403).json({ success: false, message: "This account is not approved for dashboard access." });
    }

    req.doctor = doctor;
    req.sessionTokenHash = tokenHash;
    next();
  } catch (error) {
    console.error("Session authentication error:", error.message);
    res.status(500).json({ success: false, message: "Could not verify your session." });
  }
}

export function requireAdmin(req, res, next) {
  if (req.doctor?.role !== "admin") {
    return res.status(403).json({ success: false, message: "Administrator access is required." });
  }
  next();
}

export function sessionCookie(token, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/api; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearedSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/api; Max-Age=0${secure}`;
}
