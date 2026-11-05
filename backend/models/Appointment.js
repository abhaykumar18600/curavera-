import mongoose from "mongoose";

const CONSULTATION_AREAS = [
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

const appointmentSchema = new mongoose.Schema(
  {
    recordType: {
      type: String,
      enum: ["appointment", "patient"],
      default: "appointment"
    },
    mode: {
      type: String,
      enum: ["Clinic visit", "Video call", "Phone call"],
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 90
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      match: /^[6-9]\d{9}$/
    },
    age: {
      type: Number,
      min: 0,
      max: 120
    },
    gender: {
      type: String,
      enum: ["Male", "Female", "Other"]
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 120,
      default: ""
    },
    consultType: {
      type: String,
      required: true,
      enum: CONSULTATION_AREAS
    },
    // Keep YYYY-MM-DD as a date-only string to avoid timezone date shifts.
    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/
    },
    time: {
      type: String,
      enum: ["No preference", "Morning", "Afternoon", "Evening"],
      default: "No preference"
    },
    message: {
      type: String,
      trim: true,
      maxlength: 400,
      default: ""
    },
    consent: {
      type: Boolean,
      required: true,
      validate: {
        validator: value => value === true,
        message: "Consent is required."
      }
    },
    consentAt: {
      type: Date,
      default: Date.now
    },
    confirmationEmailSentAt: {
      type: Date,
      default: null
    },
    reportPublicId: {
      type: String,
      default: ""
    },
    reportFormat: {
      type: String,
      enum: ["pdf", "jpg", "jpeg", "png", "webp", ""],
      default: ""
    },
    hiddenAt: {
      type: Date,
      default: null
    },
    status: {
      type: String,
      enum: ["pending", "contacted", "confirmed", "cancelled"],
      default: "pending"
    }
  },
  { timestamps: true }
);

const Appointment = mongoose.model("Appointment", appointmentSchema);

export default Appointment;
