import crypto from "crypto";

export function adminAuth(req, res, next) {
  const expected = process.env.ADMIN_API_KEY || "";
  const provided = String(req.get("x-admin-key") || "");

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  const ok =
    expected.length >= 16 &&
    a.length === b.length &&
    crypto.timingSafeEqual(a, b);

  if (!ok) {
    return res.status(401).json({ success: false, message: "Unauthorized." });
  }
  next();
}