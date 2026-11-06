import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import Appointment from "../models/Appointment.js";
import { normalizeIndianPhone } from "../lib/publicVerification.js";
import { isValidDateOnly, isValidPreferredPeriod } from "../lib/appointmentValidation.js";
import { createSmtpMailer, validEmail } from "../lib/email.js";
import cloudinary from "../config/cloudinary.js";

const router = express.Router();

const STATUSES = ["pending", "contacted", "confirmed", "cancelled"];
const MODES = ["Clinic visit", "Video call", "Phone call"];
const GENDERS = ["Male", "Female", "Other"];
const TIMES = ["No preference", "Morning", "Afternoon", "Evening"];
const AREAS = [
  "General / Internal Medicine",
  "Diabetes",
  "High blood pressure",
  "Thyroid disorders",
  "Kidney / urinary concerns",
  "Digestive / liver concerns",
  "Respiratory concerns",
  "Fever / infection",
  "Neurology / rheumatology",
  "Multiple / complex concerns",
  "Other"
];
const MAX_PATIENT_REPORT_BYTES = 10 * 1024 * 1024;
const PATIENT_REPORT_TYPES = {
  "application/pdf": { extension: "pdf", contentType: "application/pdf" },
  "image/jpeg": { extension: "jpg", contentType: "image/jpeg" },
  "image/png": { extension: "png", contentType: "image/png" },
  "image/webp": { extension: "webp", contentType: "image/webp" }
};
const patientReportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PATIENT_REPORT_BYTES, files: 1 },
  fileFilter(req, file, callback) {
    if (!PATIENT_REPORT_TYPES[file.mimetype]) {
      return callback(new Error("Upload a PDF, JPG, PNG or WEBP report."));
    }
    return callback(null, true);
  }
});

const str = (v) => (typeof v === "string" ? v.trim() : "");

function validPatientReport(file) {
  const buffer = file.buffer;
  if (file.mimetype === "application/pdf") return buffer.subarray(0, 5).toString() === "%PDF-";
  if (file.mimetype === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (file.mimetype === "image/png") {
    return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  return buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
}

// GET /api/admin/appointments
router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (String(req.query.showHidden || "") !== "true") filter.hiddenAt = null;

    const status = String(req.query.status || "");
    if (STATUSES.includes(status)) filter.status = status;

    const q = String(req.query.q || "").trim().slice(0, 60);
    if (q) {
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(safe, "i");
      filter.$or = [{ name: rx }, { phone: rx }, { email: rx }];
    }

    const appointments = await Appointment.find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    res.json({ success: true, count: appointments.length, data: appointments });
  } catch (error) {
    console.error("Admin list error:", error.message);
    res.status(500).json({ success: false, message: "Could not load appointments." });
  }
});

router.patch("/:id/hidden", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid appointment id." });
    }
    if (typeof req.body?.hidden !== "boolean") {
      return res.status(400).json({ success: false, message: "Choose whether to hide or restore this request." });
    }

    const appointment = await Appointment.findOneAndUpdate(
      { _id: req.params.id, recordType: { $ne: "patient" } },
      { $set: { hiddenAt: req.body.hidden ? new Date() : null } },
      { new: true, runValidators: true }
    ).select("_id hiddenAt").lean();
    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment request not found." });
    }
    return res.json({ success: true, data: appointment });
  } catch (error) {
    console.error("Appointment visibility update error:", error.message);
    return res.status(500).json({ success: false, message: "Could not update appointment visibility." });
  }
});

router.get("/:id/report", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid appointment id." });
    }
    const appointment = await Appointment.findById(req.params.id)
      .select("reportPublicId reportFormat")
      .lean();
    if (!appointment || !appointment.reportPublicId || !appointment.reportFormat) {
      return res.status(404).json({ success: false, message: "No previous report is attached to this request." });
    }
    const expiresAt = Math.floor(Date.now() / 1000) + 5 * 60;
    const downloadUrl = cloudinary.utils.private_download_url(
      appointment.reportPublicId,
      appointment.reportFormat,
      { resource_type: "raw", type: "authenticated", expires_at: expiresAt, attachment: true }
    );
    return res.json({ success: true, downloadUrl });
  } catch (error) {
    console.error("Appointment report link error:", error.message);
    return res.status(500).json({ success: false, message: "Could not prepare the secure report download." });
  }
});

router.post("/:id/send-report", patientReportUpload.single("report"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid appointment id." });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Choose a report to email." });
    }
    if (!validPatientReport(req.file)) {
      return res.status(400).json({ success: false, message: "The selected report does not match its PDF or image type." });
    }

    const appointment = await Appointment.findById(req.params.id)
      .select("name")
      .lean();
    if (!appointment) {
      return res.status(404).json({ success: false, message: "Patient appointment was not found." });
    }
    const recipientEmail = str(req.body?.email).toLowerCase();
    if (!validEmail(recipientEmail)) {
      return res.status(400).json({ success: false, message: "Enter a valid patient email address." });
    }

    const mailer = createSmtpMailer();
    if (!mailer) {
      return res.status(503).json({ success: false, message: "SMTP email is not configured. The report was not sent." });
    }

    const safeName = appointment.name.replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
    const reportType = PATIENT_REPORT_TYPES[req.file.mimetype];
    await mailer.transporter.sendMail({
      from: mailer.from,
      to: recipientEmail,
      subject: "A medical report from Curavera",
      text: `Hello ${appointment.name},\n\nYour doctor has attached a medical report for you. Please find it attached to this email.\n\nIf you have questions, contact the clinic directly.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#183b38"><p>Hello ${safeName},</p><p>Your doctor has attached a medical report for you. Please find it attached to this email.</p><p>If you have questions, contact the clinic directly.</p></div>`,
      attachments: [{
        filename: `patient-report.${reportType.extension}`,
        content: req.file.buffer,
        contentType: reportType.contentType
      }]
    });

    return res.json({ success: true, message: `Report emailed to ${recipientEmail}.` });
  } catch (error) {
    console.error("Patient report email error:", error.code || "UNKNOWN", error.message);
    const errorCode = /^[A-Z0-9_]+$/.test(error.code || "") ? ` (${error.code})` : "";
    return res.status(502).json({
      success: false,
      message: `Could not email the report${errorCode}. Check the SMTP configuration and try again.`
    });
  }
});

// POST /api/admin/appointments  -> doctor manually adds a patient
router.post("/", async (req, res) => {
  try {
    const b = req.body ?? {};
    const data = {
      mode: str(b.mode),
      name: str(b.name),
      phone: normalizeIndianPhone(str(b.phone)),
      age: Number(b.age),
      gender: str(b.gender),
      email: str(b.email).toLowerCase(),
      consultType: str(b.consultType),
      date: str(b.date),
      time: str(b.time) || "No preference",
      message: str(b.message)
    };

    const err =
      !MODES.includes(data.mode) ? "Invalid mode." :
      data.name.length < 2 || data.name.length > 90 ? "Invalid name." :
      !data.phone ? "Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9." :
      !Number.isFinite(data.age) || data.age < 0 || data.age > 120 ? "Invalid age." :
      !GENDERS.includes(data.gender) ? "Invalid gender." :
      data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) ? "Invalid email." :
      !AREAS.includes(data.consultType) ? "Invalid consultation area." :
      !isValidDateOnly(data.date) ? "Select today or a future date." :
      !TIMES.includes(data.time) ? "Invalid time." :
      !isValidPreferredPeriod(data.date, data.time) ? "That preferred time period has already passed today." :
      data.message.length > 400 ? "Note is too long." : "";

    if (err) return res.status(400).json({ success: false, message: err });

    const created = await Appointment.create({
      ...data,
      recordType: "patient",
      consent: true,         // doctor-entered record
      status: "confirmed"    // counts as a visit in the Patients tab
    });

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    console.error("Admin add error:", error.message);
    res.status(500).json({ success: false, message: "Could not add patient." });
  }
});

// PATCH /api/admin/appointments/:id/status   body: { status }
router.patch("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const status = String(req.body?.status || "");

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid appointment id." });
    }
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status." });
    }

    const updated = await Appointment.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: "Appointment not found." });
    }

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Admin status error:", error.message);
    res.status(500).json({ success: false, message: "Could not update status." });
  }
});

router.post("/:id/send-confirmation", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid appointment id." });
    }

    const appointment = await Appointment.findById(req.params.id).lean();
    if (!appointment || appointment.recordType === "patient") {
      return res.status(404).json({ success: false, message: "Appointment request not found." });
    }
    if (appointment.status !== "confirmed") {
      return res.status(409).json({ success: false, message: "Confirm the appointment before sending its slip." });
    }
    if (appointment.confirmationEmailSentAt) {
      return res.json({ success: true, message: "The confirmation slip was already emailed." });
    }
    if (!appointment.email) {
      return res.status(400).json({ success: false, message: "Appointment confirmed, but no patient email address is available for the slip." });
    }

    const mailer = createSmtpMailer();
    if (!mailer) {
      return res.status(503).json({ success: false, message: "Appointment confirmed, but SMTP email is not configured. The approval slip was not emailed." });
    }

    const safe = value => String(value || "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
    const date = appointment.date;
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#183b38"><h1 style="color:#087f72">Appointment confirmed</h1><p>Hello ${safe(appointment.name)},</p><p>Your appointment request has been approved. Please keep this appointment slip for your reference.</p><table style="border-collapse:collapse;width:100%"><tr><td style="padding:8px;border:1px solid #ddd">Date</td><td style="padding:8px;border:1px solid #ddd">${safe(date)}</td></tr><tr><td style="padding:8px;border:1px solid #ddd">Preferred time</td><td style="padding:8px;border:1px solid #ddd">${safe(appointment.time)}</td></tr><tr><td style="padding:8px;border:1px solid #ddd">Consultation</td><td style="padding:8px;border:1px solid #ddd">${safe(appointment.mode)}</td></tr><tr><td style="padding:8px;border:1px solid #ddd">Request ID</td><td style="padding:8px;border:1px solid #ddd">${safe(appointment._id)}</td></tr></table><p>Please contact the clinic if you need to change your appointment. This slip is not a prescription.</p></div>`;
    await mailer.transporter.sendMail({
      from: mailer.from,
      to: appointment.email,
      subject: "Your Curavera appointment is confirmed",
      text: `Hello ${appointment.name}, your appointment is confirmed for ${date} (${appointment.time}), ${appointment.mode}. Request ID: ${appointment._id}.`,
      html
    });
    await Appointment.updateOne(
      { _id: appointment._id, confirmationEmailSentAt: null },
      { $set: { confirmationEmailSentAt: new Date() } }
    );

    return res.json({ success: true, message: `Appointment confirmed; slip emailed to ${appointment.email}.` });
  } catch (error) {
    console.error("Appointment confirmation email error:", error.code || "UNKNOWN", error.message);
    const errorCode = /^[A-Z0-9_]+$/.test(error.code || "") ? ` (${error.code})` : "";
    return res.status(502).json({
      success: false,
      message: `Appointment confirmed, but the slip email failed${errorCode}. Check SMTP settings and retry.`
    });
  }
});

export default router;