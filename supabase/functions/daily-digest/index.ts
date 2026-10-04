// Daily digest: emails anything due/overdue within the next 3 days.
// Runs on a schedule (pg_cron -> pg_net -> this function), not from the browser.
// Credentials come from Supabase Vault via the get_digest_secrets() SQL function
// (service-role only) — nothing sensitive lives in this file or the repo.
//
// Daily/weekly routines (Personal Tasks with recurrence set) are excluded on
// purpose: they're due "today" by definition, so including them would mean
// they show up in every single digest forever.

import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";

const URGENT_WINDOW_DAYS = 3;
const SUBJECT = "CALM YOUR MIND: URGENT UPDATES";

const CATEGORY_LABELS: Record<string, string> = {
  bills: "Bills",
  house: "House Projects",
  tasks: "Personal Tasks",
  travel: "Travel Plans",
  thoughts: "Random Thoughts",
};

function serviceRoleKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const bundle = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  return bundle["default"];
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatMoney(n: number | null): string {
  if (n == null) return "";
  return " — $" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function priorityWord(p: number): string {
  return p >= 5 ? "High" : p <= 1 ? "Low" : "Medium";
}

Deno.serve(async (_req) => {
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey());

    const { data: secrets, error: secretsErr } = await admin.rpc("get_digest_secrets").single();
    if (secretsErr || !secrets) throw new Error("couldn't load digest secrets: " + secretsErr?.message);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + URGENT_WINDOW_DAYS);
    const cutoffISO = cutoff.toISOString().slice(0, 10);

    // Due/overdue within the window, OR manually flagged urgent regardless of
    // due date -- either one qualifies for the digest.
    const { data: items, error: itemsErr } = await admin
      .from("items")
      .select("*")
      .eq("status", "active")
      .neq("recurrence", "daily")
      .neq("recurrence", "weekly")
      .or(`and(due_date.not.is.null,due_date.lte.${cutoffISO}),manual_urgent.eq.true`)
      .order("priority", { ascending: false })
      .order("due_date", { ascending: true });
    if (itemsErr) throw new Error("couldn't load items: " + itemsErr.message);

    const todayISO = new Date().toISOString().slice(0, 10);
    const grouped: Record<string, typeof items> = {};
    for (const item of items ?? []) {
      (grouped[item.category] ??= []).push(item);
    }

    const count = items?.length ?? 0;
    let html: string;

    if (count === 0) {
      html = `<p>Nothing due or overdue in the next ${URGENT_WINDOW_DAYS} days. 🎉</p>`;
    } else {
      html = Object.entries(grouped).map(([category, catItems]) => {
        const rows = catItems.map((item) => {
          const overdue = item.due_date != null && item.due_date < todayISO;
          const dateLine = item.due_date ? ` — ${formatDate(item.due_date)}` : "";
          const notesLine = item.notes ? `<br><span style="color:#6b6b6b;font-size:0.85em;">${item.notes}</span>` : "";
          return `<li>${overdue ? "⚠️ " : ""}<strong>${item.title}</strong>${dateLine}${formatMoney(item.amount)} (${priorityWord(item.priority)} priority)${notesLine}</li>`;
        }).join("");
        return `<h3>${CATEGORY_LABELS[category] ?? category}</h3><ul>${rows}</ul>`;
      }).join("");
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: secrets.gmail_user, pass: secrets.gmail_app_password },
    });

    await transporter.sendMail({
      from: secrets.gmail_user,
      to: secrets.recipient_email,
      subject: SUBJECT,
      html,
    });

    return new Response(JSON.stringify({ ok: true, sent: count }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
