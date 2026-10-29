# TripSplit: AI Trip Treasurer

**No more "I'll pay you later." No more "I already sent it."**

TripSplit protects the organizer from friends who don't pay, and protects friends from an organizer who doesn't book. Friends agree on prices before anyone pays, PayPal **holds** each share, and the organizer collects everyone **at once** only when the trip pot is full. If the trip falls apart, holds are released and payments are refunded, so nobody loses money.

Built for the PayPal AI Hackathon. Runs on the **PayPal sandbox**, so no real money moves.

**Live demo:** https://tripsplit-cwoa.onrender.com
(Free hosting: the first load can take up to a minute while the server wakes up.)

---

## For judges: how to try it

1. Open the live demo and sign in with the **organizer PIN: `2468`**
2. Optional: under **Plan the trip with AI**, describe a trip (you can paste a flight or hotel you found, with its price) and click **Plan with AI**.
3. Under **Invite links**, click **Open as Sam**. Tap **I'm in** on a few activities and watch Sam's share update.
4. Click the **PayPal** button and log in with this **sandbox buyer account** (fake money):
   - Email: `JUDGE_SANDBOX_EMAIL`
   - Password: `JUDGE_SANDBOX_PASSWORD`
5. Repeat for each friend (the same PayPal login works for all of them). Each share shows **Held · not charged yet**.
6. Back in the organizer view, click **Collect everyone & book**. Everyone is charged at the same time.
7. Click **Cancel trip** to see payments refunded. Items marked *Non-refundable once booked* (like the train in the sample plan) are held back, exactly as each friend agreed before paying. Check the **Money trail** at the bottom.

The demo resets when the free server restarts, so you always start with a fresh trip.

---

## The problem

On group trips, one person usually books everything and then spends weeks chasing friends who say "I'll pay you later," or who claim they already paid. A single TikTok about friends not paying their share of a trip drew 6,000+ likes and hundreds of comments from people with the same story. PayPal's own group collection feature, Money Pools, was shut down in 2021.

## What it does

- **Trip setup:** the organizer names the trip, adds friends (2 to 12), and sets a pay-by date. Each friend gets a private invite link.
- **AI trip planner:** describe the trip and AI suggests shared costs (stays, group transport), flights, places to eat, and activities with a price per person. Flights or hotels you paste in are used at your **exact** price and tagged "Your price"; everything AI guesses is tagged "AI estimate".
- **Add what you found:** the organizer can add a flight, hotel, restaurant, or activity by hand with its exact price and link.
- **Plans with no surprises:** each friend taps **I'm in** or **Skip**. Their share = their part of the shared costs + only what they joined. If a price changes, anyone who agreed to the old price must re-approve before paying.
- **No non-refundable surprises:** every item is labeled *Refundable*, *Non-refundable once booked*, or *Refund policy: check*. Prices or policies the organizer gives are used exactly; AI suggests the typical policy and labels it as a guess to check. Friends confirm before joining anything non-refundable and tick a box before paying. If a trip is cancelled after booking, friends get back the refundable part; the non-refundable part, already paid to vendors, is shown up front.
- **Hold until the pot is full:** paying places a PayPal hold, not a charge. The organizer collects everyone at once when all shares are held.
- **Cancel safely:** holds are released (never charged) and collected payments are refunded through PayPal.
- **Proof, not promises:** a share is marked paid only when PayPal confirms it. Every hold, charge, release, and refund appears in the **money trail** with its PayPal ID and time.
- **Deadlines and late friends:** shares show a pay-by date; late friends are flagged for the organizer.
- **AI reminders:** one click writes a friendly, personal group-chat reminder for each friend who hasn't paid.

## How PayPal is used

| PayPal tool | What it does in TripSplit |
| --- | --- |
| Orders API v2 with `intent: AUTHORIZE` | Creates an order for each friend's share and places a hold when they approve |
| Payments API: capture authorization | Collects every held share at once when the pot is full |
| Payments API: void authorization | Releases holds if the trip is cancelled, so nobody is charged |
| Payments API: refund capture (full or partial) | Refunds collected shares if the trip is cancelled after booking, minus any non-refundable part each friend agreed to |
| PayPal JavaScript SDK | Shows the PayPal checkout buttons for each friend |
| OAuth 2.0 (client credentials) | Authenticates the server with PayPal; credentials never reach the browser |

## How AI is used

TripSplit uses **Claude** (Anthropic Messages API, model `claude-sonnet-5-5`) for:

- **Trip planning:** turns a short description into shared costs, flights, places to eat, and activities with prices per person, keeping any prices the organizer pasted in exactly.
- **Refund policies:** labels each item's typical refund policy (marked as a guess to check), or uses the policy the organizer gave.
- **Payment reminders:** writes a short, friendly message for each friend who hasn't paid, mentioning their share, the pay-by date, and any price they need to re-approve.

AI never moves money. Its answers are treated as untrusted: every field is checked, prices are limited to safe ranges, links must be `https://`, and the text is escaped before it's shown.

## Security

- Amounts are calculated on the **server**, never trusted from the browser.
- A hold counts only if PayPal confirms it for the right friend, the exact amount, and the right currency. Each order can be used once.
- Secrets live in environment variables (`.env` locally, Render settings online) and are never committed to GitHub.
- Each friend acts only through their private invite link. Organizer actions need a PIN, checked in constant time, with a lockout after 10 wrong tries.
- All text from people and from AI is escaped before display (prevents XSS); links are limited to `https://`.
- AI requests are capped per hour so a public demo can't run up costs.
- Shared costs lock once anyone's money is on hold, and nothing someone paid for can be removed.

## Run it locally

You need **Node.js 18 or newer** and a free **PayPal Developer** account (sandbox).

1. Download or clone this repo, then open a terminal in the project folder.
2. Install the libraries:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your values:

   | Variable | What to put |
   | --- | --- |
   | `PAYPAL_CLIENT_ID` | Sandbox Client ID from developer.paypal.com → Apps & Credentials |
   | `PAYPAL_CLIENT_SECRET` | Sandbox Secret from the same app |
   | `ORGANIZER_PIN` | Any PIN you choose |
   | `ANTHROPIC_API_KEY` | Optional. A Claude API key from platform.claude.com; without it, AI buttons are turned off and a sample plan is used |
   | `ANTHROPIC_MODEL` | `claude-sonnet-5-5` |
   | `AI_CALLS_PER_HOUR` | Optional. Defaults to 20 |
   | `PORT` | Optional. Defaults to 3000 |

4. Start the app:
   ```bash
   npm run dev
   ```
5. Open http://localhost:3000, sign in with your PIN, and use the invite links to act as each friend. Pay with a **sandbox personal account** from developer.paypal.com → Testing Tools → Sandbox Accounts.

## Tech stack and tools

- **Backend:** Node.js, Express
- **Frontend:** HTML, CSS, and JavaScript (no framework), PayPal JavaScript SDK
- **Payments:** PayPal Orders API v2 and Payments API (sandbox)
- **AI:** Claude via the Anthropic Messages API
- **Hosting:** Render (sponsor tool) runs the live demo

## Limits of this demo

- Trip data is kept in memory, so it resets when the server restarts. A real launch would use a database.
- The demo runs in the PayPal sandbox and collects money into the app's own account. A real launch would use a marketplace payment platform and real user accounts.
- AI prices are estimates, not live prices. Real prices come from what the organizer pastes in or adds.

## License

MIT. See [LICENSE](LICENSE).
