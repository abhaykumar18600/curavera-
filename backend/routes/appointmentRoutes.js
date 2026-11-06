import express from "express";
import crypto from "crypto";
import multer from "multer";
import Appointment from "../models/Appointment.js";
import cloudinary from "../config/cloudinary.js";
import {
  normalizeIndianPhone
} from "../lib/publicVerification.js";
import {
  isConsentGiven,
  isValidDateOnly,
  isValidPreferredPeriod
} from "../lib/appointmentValidation.js";

const router = express.Router();

const ALLOWED_MODES = ["Clinic visit", "Video call", "Phone call"];
const ALLOWED_GENDERS = ["Male", "Female", "Other"];

const ALLOWED_AREAS = [
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

const ALLOWED_TIMES = ["No preference", "Morning", "Afternoon", "Evening"];
const MAX_REPORT_BYTES = 10 * 1024 * 1024;
const REPORT_FORMATS = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};
const reportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_REPORT_BYTES, files: 1 },
  fileFilter(req, file, callback) {
    if (!REPORT_FORMATS[file.mimetype]) {
      return callback(new Error("Upload a PDF, JPG, PNG or WEBP report."));
    }
    return callback(null, true);
  }
});

const cleanString = value =>
  typeof value === "string" ? value.trim() : "";

function validReportContent(file) {
  const buffer = file.buffer;
  if (file.mimetype === "application/pdf") return buffer.subarray(0, 5).toString() === "%PDF-";
  if (file.mimetype === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (file.mimetype === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
}

function uploadPrivateReport(file) {
  const format = REPORT_FORMATS[file.mimetype];
  const publicId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "medicare/reports",
        public_id: publicId,
        resource_type: "raw",
        type: "authenticated",
        format
      },
      (error, result) => {
        if (error) return reject(error);
        if (!result?.public_id) return reject(new Error("The report upload did not return an asset id."));
        return resolve({ publicId: result.public_id, format });
      }
    );
    stream.end(file.buffer);
  });
}

router.post("/", reportUpload.single("report"), async (req, res) => {
  let uploadedReport;
  try {
    const body = req.body ?? {};

    const mode = cleanString(body.mode);
    const name = cleanString(body.name);
    const phone = normalizeIndianPhone(body.phone);
    const age = Number(body.age);
    const gender = cleanString(body.gender);
    const email = cleanString(body.email).toLowerCase();
    const consultType = cleanString(body.consultType);
    const date = cleanString(body.date);
    const time = cleanString(body.time) || "No preference";
    const message = cleanString(body.message);

    if (!ALLOWED_MODES.includes(mode)) {
      return res.status(400).json({
        success: false,
        message: "Please select a valid consultation mode."
      });
    }

    if (name.length < 2 || name.length > 90) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid name (2–90 characters)."
      });
    }

    if (!Number.isFinite(age) || age < 0 || age > 120) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid age (0–120)."
      });
    }

    if (!ALLOWED_GENDERS.includes(gender)) {
      return res.status(400).json({
        success: false,
        message: "Please select a valid gender."
      });
    }

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9."
      });
    }

    if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email address to receive your confirmed appointment slip."
      });
    }

    if (!ALLOWED_AREAS.includes(consultType)) {
      return res.status(400).json({
        success: false,
        message: "Please select a valid consultation area."
      });
    }

    if (!isValidDateOnly(date)) {
      return res.status(400).json({
        success: false,
        message: "Please select today or a future date."
      });
    }

    if (!ALLOWED_TIMES.includes(time)) {
      return res.status(400).json({
        success: false,
        message: "Please select a valid preferred time."
      });
    }

    if (!isValidPreferredPeriod(date, time)) {
      return res.status(400).json({
        success: false,
        message: "That preferred time period has already passed today. Choose a later period or another date."
      });
    }

    if (message.length > 400) {
      return res.status(400).json({
        success: false,
        message: "Brief note must be 400 characters or fewer."
      });
    }

    if (req.file && !validReportContent(req.file)) {
      return res.status(400).json({
        success: false,
        message: "The selected report file does not match its PDF or image type."
      });
    }

    if (!isConsentGiven(body.consent)) {
      return res.status(400).json({
        success: false,
        message: "Please accept the consent statement."
      });
    }

    if (req.file) uploadedReport = await uploadPrivateReport(req.file);
    const appointment = await Appointment.create({
      mode,
      name,
      phone,
      age,
      gender,
      email,
      consultType,
      date,
      time,
      message,
      ...(uploadedReport ? {
        reportPublicId: uploadedReport.publicId,
        reportFormat: uploadedReport.format
      } : {}),
      consent: true,
      status: "pending"
    });

    return res.status(201).json({
      success: true,
      message: "Your request has been received for clinic review.",
      requestId: appointment._id
    });
  } catch (error) {
    console.error("Appointment API error:", error.message);
    if (uploadedReport) {
      try {
        await cloudinary.uploader.destroy(uploadedReport.publicId, {
          resource_type: "raw",
          type: "authenticated"
        });
      } catch (cleanupError) {
        console.error("Failed to clean up unlinked appointment report:", cleanupError.message);
      }
    }

    return res.status(500).json({
      success: false,
      message: "Unable to submit your request right now. Please try again."
    });
  }
});

export default router;
