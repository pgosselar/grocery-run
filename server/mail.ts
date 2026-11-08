// Outgoing email through Resend (https://resend.com). Optional: without RESEND_API_KEY,
// password resets go through `node server/cli.ts reset-password <email>` instead.
const KEY = process.env.RESEND_API_KEY ?? "";
const FROM = process.env.EMAIL_FROM ?? "";

export const emailEnabled = !!(KEY && FROM);

export async function sendEmail(to: string, subject: string, text: string, html: string) {
  if (!emailEnabled) throw new Error("Email isn't set up");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
