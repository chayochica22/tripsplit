// TripSplit server
// Express + PayPal Orders API v2 + Payments API (sandbox)
//
// How the money moves:
//   1. Each traveler approves their share. PayPal AUTHORIZES it: the money is
//      held on their account but not taken yet.
//   2. When everyone has committed, the organizer clicks "Collect & book".
//      The server CAPTURES every hold at once.
//   3. If the trip is cancelled: holds are VOIDED (nobody is charged) and
//      anything already captured is REFUNDED to whoever paid.
require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, ORGANIZER_PIN, PORT = 3000 } = process.env;
const PAYPAL_API = "https://api-m.sandbox.paypal.com"; // sandbox only

if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
  console.error("Missing PayPal credentials. Copy .env.example to .env and fill it in.");
  process.exit(1);
}
if (!ORGANIZER_PIN) {
  console.warn("No ORGANIZER_PIN in .env: organizer buttons (collect, cancel) are turned off.");
}

// ---------------------------------------------------------------
// Demo trip data (in memory). Later: AI generates this + a database.
// Traveler status: "owes" -> "held" -> "paid"  (or "released" / "refunded")
// Trip status:     "collecting" -> "booked"    (or "cancelled")
// ---------------------------------------------------------------
const trip = {
  name: "Madrid + Lisbon Getaway",
  currency: "USD",
  total: 3000.0,
  status: "collecting",
  travelers: [
    { id: "t1", name: "Dania", status: "owes" },
    { id: "t2", name: "Sam", status: "owes" },
    { id: "t3", name: "Alex", status: "owes" },
  ],
};

// Even split for now. Later: custom/AI splits.
function shareFor() {
  return (trip.total / trip.travelers.length).toFixed(2);
}

// Money trail: every dollar in and out, newest first, with PayPal IDs.
const trail = [];
function logEvent(who, action, amount, paypalId) {
  trail.unshift({ time: new Date().toISOString(), who, action, amount, paypalId });
}

// Orders this server created: orderId -> { travelerId, amount, currency }.
// SECURITY: only orders listed here can be authorized, so nobody can use an
// order they built themselves (for example a $1 order tagged "Sam").
const createdOrders = new Map();

// ---------------------------------------------------------------
// PayPal helpers
// ---------------------------------------------------------------
async function getAccessToken() {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function paypalRequest(method, urlPath, body) {
  const token = await getAccessToken();
  const res = await fetch(`${PAYPAL_API}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {}; // some calls (like void) answer with no body
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal error ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

// ---------------------------------------------------------------
// Organizer check
// SECURITY: compares the PIN in constant time, so an attacker can't guess it
// faster by measuring how long each wrong answer takes.
// ---------------------------------------------------------------
function isOrganizer(req) {
  if (!ORGANIZER_PIN) return false;
  const given = Buffer.from(String(req.body?.pin || ""));
  const real = Buffer.from(ORGANIZER_PIN);
  return given.length === real.length && crypto.timingSafeEqual(given, real);
}

// ---------------------------------------------------------------
// Routes
// ---------------------------------------------------------------

// Frontend needs the client ID (public, safe to share) to load the PayPal SDK.
app.get("/api/config", (req, res) => {
  res.json({ clientId: PAYPAL_CLIENT_ID, currency: trip.currency, intent: "authorize" });
});

app.get("/api/trip", (req, res) => {
  const share = shareFor();
  const committed = trip.travelers.filter((t) => t.status === "held" || t.status === "paid");
  res.json({
    ...trip,
    share,
    potCommitted: (committed.length * Number(share)).toFixed(2),
    committedCount: committed.length,
    organizerEnabled: Boolean(ORGANIZER_PIN),
    trail,
  });
});

// Step 1a: create an order for one traveler's share.
// The amount is set HERE on the server, never trusted from the browser.
app.post("/api/orders", async (req, res) => {
  try {
    if (trip.status !== "collecting") return res.status(400).json({ error: "This trip is no longer collecting money" });
    const traveler = trip.travelers.find((t) => t.id === req.body.travelerId);
    if (!traveler) return res.status(404).json({ error: "Traveler not found" });
    if (traveler.status !== "owes") return res.status(400).json({ error: "Already committed" });

    const amount = shareFor();
    const order = await paypalRequest("POST", "/v2/checkout/orders", {
      intent: "AUTHORIZE", // hold the money now, take it later
      purchase_units: [
        {
          reference_id: traveler.id,
          description: `${traveler.name}'s share - ${trip.name}`,
          amount: { currency_code: trip.currency, value: amount },
        },
      ],
    });
    createdOrders.set(order.id, { travelerId: traveler.id, amount, currency: trip.currency });
    res.json({ id: order.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create order" });
  }
});

// Step 1b: after the traveler approves in the popup, place the hold.
app.post("/api/orders/:orderId/authorize", async (req, res) => {
  try {
    // SECURITY 1: only orders this server created.
    const expected = createdOrders.get(req.params.orderId);
    if (!expected) return res.status(400).json({ error: "Unknown order" });

    const result = await paypalRequest("POST", `/v2/checkout/orders/${encodeURIComponent(req.params.orderId)}/authorize`);
    createdOrders.delete(req.params.orderId); // an order can only be used once

    const unit = result.purchase_units?.[0];
    const hold = unit?.payments?.authorizations?.[0];

    // SECURITY 2: right traveler, exact amount and currency, hold really created.
    const ok =
      result.status === "COMPLETED" &&
      hold?.status === "CREATED" &&
      unit?.reference_id === expected.travelerId &&
      hold?.amount?.value === expected.amount &&
      hold?.amount?.currency_code === expected.currency;

    if (!ok) {
      console.warn("Hold rejected: amount, traveler, or status did not match", req.params.orderId);
      return res.status(400).json({ error: "Payment did not match the expected share" });
    }

    const traveler = trip.travelers.find((t) => t.id === expected.travelerId);
    traveler.status = "held";
    traveler.authorizationId = hold.id;
    traveler.heldAt = hold.create_time || new Date().toISOString();
    traveler.holdExpires = hold.expiration_time || null;
    logEvent(traveler.name, "Share held (not charged yet)", expected.amount, hold.id);
    res.json({ status: "HELD" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not place the hold" });
  }
});

// Step 2: organizer collects everyone at once, only when the pot is full.
app.post("/api/organizer/collect", async (req, res) => {
  if (!isOrganizer(req)) return res.status(403).json({ error: "Wrong organizer PIN" });
  if (trip.status !== "collecting") return res.status(400).json({ error: "Trip is not collecting" });
  if (!trip.travelers.every((t) => t.status === "held")) {
    return res.status(400).json({ error: "Not everyone has committed yet" });
  }

  const problems = [];
  for (const t of trip.travelers) {
    try {
      const cap = await paypalRequest("POST", `/v2/payments/authorizations/${encodeURIComponent(t.authorizationId)}/capture`, {});
      if (cap.status === "COMPLETED") {
        t.status = "paid";
        t.transactionId = cap.id;
        t.paidAt = cap.create_time || new Date().toISOString();
        logEvent(t.name, "Collected into the trip pot", shareFor(), cap.id);
      } else {
        problems.push(`${t.name}: ${cap.status}`);
      }
    } catch (err) {
      console.error(err);
      problems.push(`${t.name}: capture failed`);
    }
  }
  if (problems.length === 0) {
    trip.status = "booked";
    logEvent("Organizer", "Pot full, trip booked", trip.total.toFixed(2), "");
  }
  res.json({ status: trip.status, problems });
});

// Step 3: cancel. Release holds (no charge) and refund anything collected.
app.post("/api/organizer/cancel", async (req, res) => {
  if (!isOrganizer(req)) return res.status(403).json({ error: "Wrong organizer PIN" });
  if (trip.status === "cancelled") return res.status(400).json({ error: "Already cancelled" });

  const problems = [];
  for (const t of trip.travelers) {
    try {
      if (t.status === "held") {
        await paypalRequest("POST", `/v2/payments/authorizations/${encodeURIComponent(t.authorizationId)}/void`);
        t.status = "released";
        logEvent(t.name, "Hold released, never charged", shareFor(), t.authorizationId);
      } else if (t.status === "paid") {
        const refund = await paypalRequest("POST", `/v2/payments/captures/${encodeURIComponent(t.transactionId)}/refund`, {});
        t.status = "refunded";
        t.refundId = refund.id;
        logEvent(t.name, "Refunded to their PayPal", shareFor(), refund.id);
      }
    } catch (err) {
      console.error(err);
      problems.push(`${t.name}: could not release or refund`);
    }
  }
  trip.status = "cancelled";
  res.json({ status: trip.status, problems });
});

app.listen(PORT, () => {
  console.log(`TripSplit running at http://localhost:${PORT}`);
});
