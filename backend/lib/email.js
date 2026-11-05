import nodemailer from "nodemailer";

export function validEmail(value) {
  return typeof value === "string" && value.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function createSmtpMailer() {
  const host = (process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const from = (process.env.SMTP_FROM || "").trim();
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  const secure = process.env.SMTP_SECURE === "true";

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !validEmail(from) || Boolean(user) !== Boolean(pass)) {
    return null;
  }

  return {
    from,
    transporter: nodemailer.createTransport({
      host,
      port,
      secure,
      ...(user ? { auth: { user, pass } } : {})
    })
  };
}
