import nodemailer from "nodemailer";

export function validEmail(value) {
  return typeof value === "string" && value.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function createEmailSender() {
  const provider = (process.env.EMAIL_PROVIDER || "smtp").trim().toLowerCase();
  const from = (process.env.EMAIL_FROM || process.env.SMTP_FROM || "").trim();

  if (!validEmail(from)) return null;

  if (provider === "brevo") {
    const apiKey = (process.env.BREVO_API_KEY || "").trim();
    const fromName = (process.env.EMAIL_FROM_NAME || "Curavera").trim();
    if (!apiKey || !fromName) return null;

    return {
      from,
      async sendMail({ to, subject, text, html, attachments = [] }) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        let response;
        try {
          response = await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: {
              "api-key": apiKey,
              "Content-Type": "application/json",
              Accept: "application/json"
            },
            body: JSON.stringify({
              sender: { name: fromName, email: from },
              to: [{ email: to }],
              subject,
              ...(text ? { textContent: text } : {}),
              ...(html ? { htmlContent: html } : {}),
              ...(attachments.length ? {
                attachment: attachments.map(attachment => ({
                  name: attachment.filename,
                  content: attachment.content.toString("base64")
                }))
              } : {})
            }),
            signal: controller.signal
          });
        } catch (error) {
          const code = error.name === "AbortError" ? "BREVO_TIMEOUT" : "BREVO_NETWORK_ERROR";
          throw Object.assign(new Error("Brevo email API request failed."), { code });
        } finally {
          clearTimeout(timeout);
        }

        if (!response.ok) {
          throw Object.assign(
            new Error(`Brevo email API returned HTTP ${response.status}.`),
            { code: `BREVO_HTTP_${response.status}` }
          );
        }
        return response.json().catch(() => ({}));
      }
    };
  }

  if (provider !== "smtp") return null;

  const host = (process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  const secure = process.env.SMTP_SECURE === "true";

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !validEmail(from) || Boolean(user) !== Boolean(pass)) {
    return null;
  }

  return {
    from,
    sendMail: message => nodemailer.createTransport({
      host,
      port,
      secure,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      ...(user ? { auth: { user, pass } } : {})
    }).sendMail(message)
  };
}
