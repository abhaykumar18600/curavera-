import mongoose from "mongoose";

const doctorAccountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 90 },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 120 },
    phone: { type: String, trim: true, unique: true, sparse: true, maxlength: 18 },
    specialization: { type: String, trim: true, maxlength: 120, default: "" },
    photoUrl: { type: String, trim: true, maxlength: 500, default: "" },
    registrationNumber: { type: String, required: true, trim: true, maxlength: 60 },
    passwordHash: { type: String, required: true },
    passwordSalt: { type: String, required: true },
    passwordResetHash: { type: String, default: "" },
    passwordResetExpiresAt: { type: Date, default: null },
    passwordResetAttempts: { type: Number, default: 0 },
    passwordResetRequestedAt: { type: Date, default: null },
    role: { type: String, enum: ["admin", "doctor"], default: "doctor" },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" }
  },
  { timestamps: true }
);

const DoctorAccount = mongoose.model("DoctorAccount", doctorAccountSchema);

export default DoctorAccount;
