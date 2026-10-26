// TripSplit starter server
// Express + PayPal Orders API v2 (sandbox)
require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PORT = 3000 } = process.env;
const PAYPAL_API = "https://api-m.sandbox.paypal.com"; // sandbox only

if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
  console.error("Missing PayPal credentials. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

// ---------------------------------------------------------------
// Demo trip data (in memory). Later: AI generates this + a database.
// ---------------------------------------------------------------
const trip = {
  name: "Madrid + Lisbon Getaway",
  currency: "USD",
  total: 3000.0,
  travelers: [
    { id: "t1", name: "Dania", paid: false },
    { id: "t2", name: "Sam", paid: false },
    { id: "t3", name: "Alex", paid: false },
  ],
};
// Even split for now. Later: custom/AI splits.
function shareFor() {
  return (trip.total / trip.travelers.length).toFixed(2);
}

// Orders this server created: orderId -> { travelerId, amount, currency }.
// SECURITY: capture only accepts orders listed here, so nobody can capture
// an order they built themselves (for example a $1 order tagged "Sam").
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
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal error ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

// ---------------------------------------------------------------
// Routes
// ---------------------------------------------------------------

// Frontend needs the client ID (public, safe to share) to load the PayPal SDK.
app.get("/api/config", (req, res) => {
  res.json({ clientId: PAYPAL_CLIENT_ID, currency: trip.currency });
});

app.get("/api/trip", (req, res) => {
  res.json({ ...trip, share: shareFor() });
});

// Create an order for one traveler's share.
// The amount is set HERE on the server, never trusted from the browser.
app.post("/api/orders", async (req, res) => {
  try {
    const traveler = trip.travelers.find((t) => t.id === req.body.travelerId);
    if (!traveler) return res.status(404).json({ error: "Traveler not found" });
    if (traveler.paid) return res.status(400).json({ error: "Already paid" });

    const amount = shareFor();
    const order = await paypalRequest("POST", "/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: traveler.id,
          description: `${traveler.name}'s share - ${trip.name}`,
          amount: { currency_code: trip.currency, value: amount },
        },
      ],
    });
    // Remember who this order is for and how much it should be.
    createdOrders.set(order.id, { travelerId: traveler.id, amount, currency: trip.currency });
    res.json({ id: order.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create order" });
  }
});

// Capture the payment after the traveler approves it in the PayPal popup.
app.post("/api/orders/:orderId/capture", async (req, res) => {
  try {
    // SECURITY 1: only capture orders this server created.
    const expected = createdOrders.get(req.params.orderId);
    if (!expected) return res.status(400).json({ error: "Unknown order" });

    const capture = await paypalRequest("POST", `/v2/checkout/orders/${encodeURIComponent(req.params.orderId)}/capture`);
    createdOrders.delete(req.params.orderId); // an order can only be used once

    const unit = capture.purchase_units?.[0];
    const paid = unit?.payments?.captures?.[0];

    // SECURITY 2: PayPal must say COMPLETED, for the right traveler,
    // for the exact amount and currency the server set.
    const ok =
      capture.status === "COMPLETED" &&
      paid?.status === "COMPLETED" &&
      unit?.reference_id === expected.travelerId &&
      paid?.amount?.value === expected.amount &&
      paid?.amount?.currency_code === expected.currency;

    if (!ok) {
      console.warn("Capture rejected: amount, traveler, or status did not match", req.params.orderId);
      return res.status(400).json({ error: "Payment did not match the expected share" });
    }

    const traveler = trip.travelers.find((t) => t.id === expected.travelerId);
    if (traveler) {
      traveler.paid = true;
      traveler.transactionId = paid.id; // proof: PayPal's transaction ID
      traveler.paidAt = paid.create_time || new Date().toISOString();
    }
    res.json({ status: "COMPLETED" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not capture payment" });
  }
});

app.listen(PORT, () => {
  console.log(`TripSplit running at http://localhost:${PORT}`);
});
