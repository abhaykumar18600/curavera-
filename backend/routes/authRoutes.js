import crypto from "crypto";
import { promisify } from "util";
import express from "express";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import DoctorAccount from "../models/DoctorAccount.js";
import DoctorSession from "../models/DoctorSession.js";
import { createSmtpMailer, validEmail } from "../lib/email.js";
import { normalizeIndianPhone } from "../lib/publicVerification.js";
import {
  clearedSessionCookie,
  getSessionToken,
  requireAdmin,
  requireSession,
  sessionCookie
} from "../middleware/sessionAuth.js";

const router = express.Router();
const scrypt = promisify(crypto.scrypt);
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const SESSION_DURATION_SECONDS = SESSION_DURATION_MS / 1000;
const RESET_CODE_TTL_MS = 10 * 60 * 1000;
const RESET_REQUEST_COOLDOWN_MS = 60 * 1000;
const MAX_RESET_ATTEMPTS = 5;
const RESET_CODE_PATTERN = /^\d{6}$/;
const PASSWORD_RESET_MESSAGE = "If an account exists for that email, a password reset code has been sent.";
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many password reset attempts. Please try again later." }
});

const text = value => typeof value === "string" ? value.trim() : "";
const publicAccount = account => ({
  id: account._id,
  name: account.name,
  email: account.email,
  phone: account.phone || "",
  specialization: account.specialization || "",
  photoUrl: account.photoUrl || "",
  role: account.role,
  status: account.status
});

async function hashPassword(password, salt) {
  const passwordSalt = salt || crypto.randomBytes(16).toString("hex");
  const passwordHash = await scrypt(password, passwordSalt, 64);
  return { passwordSalt, passwordHash: passwordHash.toString("hex") };
}

async function issueSession(account, res) {
  const token = crypto.randomBytes(32).toString("hex");
  await DoctorSession.create({
    tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    doctor: account._id,
    expiresAt: new Date(Date.now() + SESSION_DURATION_MS)
  });
  res.setHeader("Set-Cookie", sessionCookie(token, SESSION_DURATION_SECONDS));
}

function getPasswordResetMailer() {
  const secret = process.env.PASSWORD_RESET_SECRET || "";
  const mailer = createSmtpMailer();
  return mailer && secret.length >= 32 ? { ...mailer, secret } : null;
}

function hashResetCode(email, code, secret) {
  return crypto.createHmac("sha256", secret).update(`${email}:${code}`).digest("hex");
}

router.post("/signup", async (req, res) => {
  try {
    const name = text(req.body?.name);
    const email = text(req.body?.email).toLowerCase();
    const rawPhone = text(req.body?.phone);
    const phone = normalizeIndianPhone(rawPhone);
    const registrationNumber = text(req.body?.registrationNumber);
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    const error =
      name.length < 3 || name.length > 90 ? "Enter your full name." :
      !validEmail(email) ? "Enter a valid email address." :
      !phone ? "Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9." :
      registrationNumber.length < 4 || registrationNumber.length > 60 ? "Enter a valid medical registration number." :
      password.length < 8 || password.length > 128 ? "Password must be 8–128 characters." : "";
    if (error) return res.status(400).json({ success: false, message: error });
    const { passwordSalt, passwordHash } = await hashPassword(password);
    await DoctorAccount.create({
      name,
      email,
      phone,
      registrationNumber,
      passwordHash,
      passwordSalt,
      role: "doctor",
      status: "pending"
    });

    res.status(201).json({
      success: true,
      message: "Account created. A clinic administrator must approve it before dashboard access."
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "An account with that email or phone already exists." });
    }
    console.error("Doctor signup error:", error.message);
    res.status(500).json({ success: false, message: "Could not create your account." });
  }
});

router.post("/forgot-password", resetLimiter, async (req, res) => {
  const mailer = getPasswordResetMailer();
  if (!mailer) {
    return res.status(503).json({
      success: false,
      message: "Password reset email is not configured. Contact the clinic administrator."
    });
  }

  try {
    const email = text(req.body?.email).toLowerCase();
    if (!validEmail(email)) {
      return res.status(200).json({ success: true, message: PASSWORD_RESET_MESSAGE });
    }

    const account = await DoctorAccount.findOne({ email });
    if (!account) {
      return res.status(200).json({ success: true, message: PASSWORD_RESET_MESSAGE });
    }

    const now = Date.now();
    if (account.passwordResetRequestedAt &&
        now - account.passwordResetRequestedAt.getTime() < RESET_REQUEST_COOLDOWN_MS) {
      return res.status(200).json({ success: true, message: PASSWORD_RESET_MESSAGE });
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    const codeHash = hashResetCode(email, code, mailer.secret);
    account.passwordResetHash = codeHash;
    account.passwordResetExpiresAt = new Date(now + RESET_CODE_TTL_MS);
    account.passwordResetAttempts = 0;
    account.passwordResetRequestedAt = new Date(now);
    await account.save();

    try {
      await mailer.transporter.sendMail({
        from: mailer.from,
        to: account.email,
        subject: "Your Curavera password reset code",
        text: `Your Curavera password reset code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`
      });
    } catch (error) {
      await DoctorAccount.updateOne(
        { _id: account._id, passwordResetHash: codeHash },
        {
          $set: {
            passwordResetHash: "",
            passwordResetExpiresAt: null,
            passwordResetAttempts: 0,
            passwordResetRequestedAt: null
          }
        }
      );
      console.error("Password reset email delivery failed:", error.message);
      return res.status(503).json({
        success: false,
        message: "Could not send the reset email. Check the email service settings and try again."
      });
    }

    res.json({ success: true, message: PASSWORD_RESET_MESSAGE });
  } catch (error) {
    console.error("Password reset request error:", error.message);
    res.status(500).json({ success: false, message: "Could not start password reset." });
  }
});

router.post("/reset-password", resetLimiter, async (req, res) => {
  try {
    const email = text(req.body?.email).toLowerCase();
    const code = text(req.body?.code);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!validEmail(email) || !RESET_CODE_PATTERN.test(code) || password.length < 8 || password.length > 128) {
      return res.status(400).json({
        success: false,
        message: "Enter the email, 6-digit code and a password of 8–128 characters."
      });
    }

    const account = await DoctorAccount.findOne({
      email,
      passwordResetExpiresAt: { $gt: new Date() },
      passwordResetAttempts: { $lt: MAX_RESET_ATTEMPTS }
    });
    if (!account || !account.passwordResetHash) {
      return res.status(400).json({ success: false, message: "The reset code is invalid or expired. Request a new code." });
    }

    const secret = process.env.PASSWORD_RESET_SECRET || "";
    if (secret.length < 32) {
      return res.status(503).json({ success: false, message: "Password reset is not configured." });
    }
    const expectedHash = Buffer.from(account.passwordResetHash, "hex");
    const suppliedHash = Buffer.from(hashResetCode(email, code, secret), "hex");
    if (expectedHash.length !== suppliedHash.length || !crypto.timingSafeEqual(expectedHash, suppliedHash)) {
      await DoctorAccount.updateOne(
        {
          _id: account._id,
          passwordResetHash: account.passwordResetHash,
          passwordResetExpiresAt: { $gt: new Date() },
          passwordResetAttempts: { $lt: MAX_RESET_ATTEMPTS }
        },
        { $inc: { passwordResetAttempts: 1 } }
      );
      return res.status(400).json({ success: false, message: "The reset code is invalid or expired. Request a new code." });
    }

    const { passwordSalt, passwordHash } = await hashPassword(password);
    const updated = await DoctorAccount.updateOne(
      {
        _id: account._id,
        passwordResetHash: account.passwordResetHash,
        passwordResetExpiresAt: { $gt: new Date() },
        passwordResetAttempts: { $lt: MAX_RESET_ATTEMPTS }
      },
      {
        $set: {
          passwordSalt,
          passwordHash,
          passwordResetHash: "",
          passwordResetExpiresAt: null,
          passwordResetAttempts: 0,
          passwordResetRequestedAt: null
        }
      }
    );
    if (updated.modifiedCount !== 1) {
      return res.status(400).json({ success: false, message: "The reset code is invalid or expired. Request a new code." });
    }

    await DoctorSession.deleteMany({ doctor: account._id });
    res.json({ success: true, message: "Password updated. Please log in with your new password." });
  } catch (error) {
    console.error("Password reset completion error:", error.message);
    res.status(500).json({ success: false, message: "Could not reset the password." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const identity = text(req.body?.identity).toLowerCase();
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!identity || !password || password.length > 128) {
      return res.status(400).json({ success: false, message: "Enter your email/phone and password." });
    }

    const phoneIdentity = normalizeIndianPhone(text(req.body?.identity));
    const account = await DoctorAccount.findOne({
      $or: [{ email: identity }, { phone: phoneIdentity || "__invalid_phone__" }]
    });
    if (!account) {
      await hashPassword(password, "curavera-auth-dummy-salt");
      return res.status(401).json({ success: false, message: "Email/phone or password is incorrect." });
    }

    const { passwordHash } = await hashPassword(password, account.passwordSalt);
    const supplied = Buffer.from(passwordHash, "hex");
    const stored = Buffer.from(account.passwordHash, "hex");
    if (supplied.length !== stored.length || !crypto.timingSafeEqual(supplied, stored)) {
      return res.status(401).json({ success: false, message: "Email/phone or password is incorrect." });
    }
    if (account.status === "pending") {
      return res.status(403).json({ success: false, message: "Your account is awaiting clinic administrator approval." });
    }
    if (account.status !== "approved") {
      return res.status(403).json({ success: false, message: "This account is not approved for dashboard access." });
    }

    await issueSession(account, res);
    res.json({ success: true, data: publicAccount(account) });
  } catch (error) {
    console.error("Doctor login error:", error.message);
    res.status(500).json({ success: false, message: "Could not log in right now." });
  }
});

router.get("/me", requireSession, (req, res) => {
  res.json({ success: true, data: req.doctor });
});

router.patch("/profile", requireSession, async (req, res) => {
  try {
    const name = text(req.body?.name);
    const email = text(req.body?.email).toLowerCase();
    const phone = normalizeIndianPhone(text(req.body?.phone));
    const specialization = text(req.body?.specialization);
    const photoUrl = typeof req.body?.photoUrl === "string" ? req.body.photoUrl.trim() : "";
    const error =
      name.length < 3 || name.length > 90 ? "Enter a full name (3–90 characters)." :
      !validEmail(email) ? "Enter a valid email address." :
      !phone ? "Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9." :
      specialization.length > 120 ? "Specialization must be 120 characters or fewer." :
      photoUrl.length > 500 || (photoUrl && !/^https:\/\/res\.cloudinary\.com\/[a-zA-Z0-9_-]+\/image\/upload\//.test(photoUrl))
        ? "Choose a valid uploaded profile photo." : "";
    if (error) return res.status(400).json({ success: false, message: error });

    const account = await DoctorAccount.findById(req.doctor._id);
    if (!account || account.status !== "approved") {
      return res.status(403).json({ success: false, message: "This account is not approved for profile changes." });
    }

    account.name = name;
    account.email = email;
    account.phone = phone;
    account.specialization = specialization;
    account.photoUrl = photoUrl;
    await account.save();
    return res.json({ success: true, data: publicAccount(account) });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "That email or phone number is already assigned to another account." });
    }
    console.error("Profile update error:", error.message);
    return res.status(500).json({ success: false, message: "Could not save your profile." });
  }
});

router.post("/logout", async (req, res) => {
  try {
    if (req.sessionTokenHash) {
      await DoctorSession.deleteOne({ tokenHash: req.sessionTokenHash });
    } else {
      const token = getSessionToken(req);
      if (token) {
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        await DoctorSession.deleteOne({ tokenHash });
      }
    }
    res.setHeader("Set-Cookie", clearedSessionCookie());
    res.json({ success: true });
  } catch (error) {
    console.error("Doctor logout error:", error.message);
    res.status(500).json({ success: false, message: "Could not log out." });
  }
});

router.get("/pending-accounts", requireSession, requireAdmin, async (req, res) => {
  try {
    const accounts = await DoctorAccount.find({ role: "doctor", status: "pending" })
      .select("_id name email phone registrationNumber createdAt")
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();
    res.json({ success: true, data: accounts });
  } catch (error) {
    console.error("Pending account list error:", error.message);
    res.status(500).json({ success: false, message: "Could not load pending accounts." });
  }
});

router.patch("/accounts/:id/approve", requireSession, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid account id." });
    }
    const account = await DoctorAccount.findOneAndUpdate(
      { _id: req.params.id, role: "doctor", status: "pending" },
      { status: "approved" },
      { new: true, runValidators: true }
    ).select("_id name email phone status").lean();
    if (!account) {
      return res.status(404).json({ success: false, message: "Pending account not found." });
    }
    res.json({ success: true, data: account });
  } catch (error) {
    console.error("Doctor approval error:", error.message);
    res.status(500).json({ success: false, message: "Could not approve account." });
  }
});

export async function ensureBootstrapAdmin() {
  const email = text(process.env.ADMIN_EMAIL).toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  if (!validEmail(email) || password.length < 12 || password.length > 128) {
    throw new Error("Set a valid ADMIN_EMAIL and an ADMIN_PASSWORD of 12–128 characters in backend/.env.");
  }

  const existing = await DoctorAccount.findOne({ email });
  if (existing) {
    if (existing.role !== "admin") {
      throw new Error("ADMIN_EMAIL belongs to a non-admin account. Choose a separate admin email.");
    }
    return;
  }

  const { passwordSalt, passwordHash } = await hashPassword(password);
  await DoctorAccount.create({
    name: "Clinic Administrator",
    email,
    registrationNumber: "ADMIN",
    passwordHash,
    passwordSalt,
    role: "admin",
    status: "approved"
  });
  console.log(`Bootstrap administrator ready for ${email}`);
}

export default router;
