# TripSplit — AI Trip Treasurer

Plan group trips and split costs with friends. Each traveler pays their share through PayPal, and everyone can see who's paid.

Built for the PayPal AI Hackathon (PayPal sandbox only — no real money).

## Status
- [x] Express server + PayPal Orders API v2 (create + capture)
- [x] "Who's paid" page with a PayPal button per traveler
- [ ] AI itinerary + cost estimates
- [ ] AI receipt scanning + splitting
- [ ] PayPal Payouts for reimbursements

## Run it locally
1. Install Node.js 18 or newer.
2. In this folder:
   ```bash
   npm install
   cp .env.example .env
   ```
3. Open `.env` and paste your **sandbox** Client ID and Secret from
   developer.paypal.com → Apps & Credentials → Sandbox.
4. Start the app:
   ```bash
   npm run dev
   ```
5. Open http://localhost:3000 and pay a share. Log in with a **sandbox personal account**
   (developer.paypal.com → Testing Tools → Sandbox Accounts).

## How it works
- `server.js` gets an OAuth token from PayPal, creates an order for a traveler's share, and captures it after approval.
- The share amount is calculated on the server, so a user can't change what they pay from the browser.
- `public/index.html` loads the PayPal JS SDK and shows a pay button for each unpaid traveler.

## License
MIT — see [LICENSE](LICENSE).
