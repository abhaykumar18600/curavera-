import mongoose from "mongoose";

const doctorSessionSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "DoctorAccount", required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } }
  },
  { timestamps: true }
);

const DoctorSession = mongoose.model("DoctorSession", doctorSessionSchema);

export default DoctorSession;
