export function normalizeIndianPhone(value) {
  if (typeof value !== "string" || !/^\+?[0-9\s()-]+$/.test(value.trim())) return "";
  let digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  return /^[6-9]\d{9}$/.test(digits) ? digits : "";
}
