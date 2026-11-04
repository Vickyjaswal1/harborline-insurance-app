# Harborline: Car Insurance Demo App

A small full-stack insurance app where the price **explains itself**. Move the sliders, and a live receipt shows exactly why your premium costs what it does. Then buy a policy, file a claim, and see how the payout was worked out.

I built it to learn how a Property & Casualty insurance system works, using the concepts from a "Basics of Insurance" course: underwriting, risk factors, premium, deductible, limits, exclusions, claims, and the standard vs. non-standard market.

> **This is a learning project, not a real insurer.** Use throwaway passwords, and don't enter real personal data.

## Features

- **Accounts:** sign up, sign in, sign out. Passwords are salted and hashed (scrypt), and sessions use an HttpOnly cookie.
- **Quote with a live receipt:** the underwriter logic adjusts a base premium for age, violations, mileage and parking, and shows each adjustment as a line item.
- **Underwriting decision:** every quote ends as *standard*, *non-standard* (higher risk, higher deductible) or *declined*.
- **Policies:** buy a policy with effective and expiration dates, a per-event limit, a yearly (aggregate) limit and a deductible. Cancel a policy and record its cancellation date.
- **Claims:** the server checks the policy status, that the loss date falls inside the policy period, and the exclusions (flood, war, intentional damage). It then calculates the payout and explains it.
- **Plain-language tooltips** for insurance jargon.
- **Responsive design** with a bottom tab bar on phones, an animated background, and reduced-motion support.
- **SQLite database:** everything survives a server restart.

## Tech stack

| Layer | Tools |
|---|---|
| Backend | Node.js with only built-in modules (`http`, `fs`, `path`, `crypto`) |
| Database | SQLite (Node's built-in `node:sqlite`) |
| Frontend | HTML, CSS, vanilla JavaScript, Tailwind CSS (CDN) |

There is no framework and no npm dependency, so the whole request flow is visible in `server.js`.

## Getting started

**Requirements:** Node.js **22.13 or newer** (for the built-in SQLite module). On an older Node, install `better-sqlite3` and switch the two marked lines in `db.js`.

```bash
# 1. Get the code, then open the project folder
cd insurance-app

# 2. Start the server
node server.js

# 3. Open the app
# http://localhost:3000
```

The database file `insurance.db` is created automatically on first run. Delete it to reset the app to empty.

An internet connection is needed in the browser, because Tailwind and the Google fonts load from a CDN.

## Project structure

```
insurance-app/
├── server.js          Server, API routes and insurance logic
├── db.js              Opens the SQLite database and creates the tables
├── package.json
└── public/            Frontend, served as static files
    ├── index.html     Sign in / sign up page
    ├── app.html       The app: Quote, Policies, Claims
    ├── css/
    │   ├── base.css   Colours, fonts, background, shared styles
    │   ├── login.css  Sign in page styles
    │   └── app.css    App styles (receipt, policies, claims)
    └── js/
        ├── api.js     Shared helper that calls the backend
        ├── login.js   Sign in page logic
        └── app.js     App logic
```

## API reference

All routes except sign up and sign in need a logged-in session.

| Method | Route | What it does |
|---|---|---|
| POST | `/api/signup` | Create an account |
| POST | `/api/login` | Sign in and start a session |
| GET | `/api/me` | Who is logged in |
| POST | `/api/logout` | Sign out |
| POST | `/api/quote` | Calculate the premium and underwriting decision |
| POST | `/api/policy` | Buy a policy (the server recalculates the price itself) |
| GET | `/api/policies` | List my policies |
| POST | `/api/policy/cancel` | Cancel one of my policies |
| POST | `/api/claim` | File a claim and get the payout decision |
| GET | `/api/claims` | List my claims |

## How the insurance logic works

**Premium:** `base ($600) x (1 + sum of risk adjustments)`

| Risk factor | Adjustment |
|---|---|
| Driver under 25 | +40% |
| Driver over 65 | +15% |
| Each traffic violation | +15% |
| Under 7,500 miles a year | -10% |
| Over 15,000 miles a year | +20% |
| Garage / street parking | -5% / +10% |

**Decision:** under 16 or more than 4 violations is *declined*. A total surcharge of 50% or more is *non-standard*. Anything else is *standard*. Standard policies have a $500 deductible and non-standard ones $1,000. Both have a $50,000 limit per event and a $100,000 yearly limit.

**Claim payout:** `min(loss - deductible, limit per event, yearly limit remaining)`. A claim is denied if the policy is not active, the loss date is outside the policy period, or the cause is excluded.

## Security notes

- Passwords are hashed with a per-user salt, and never stored or returned.
- All database queries use placeholders, which prevents SQL injection.
- Static files are served only from `public/`, and path traversal such as `/../server.js` is blocked.
- Request bodies are size-limited, and malformed JSON returns a clean error instead of crashing the server.
- The server recalculates prices itself and never trusts a price sent from the browser.

**Known limits:** there is no HTTPS (use a tunnel or a host that provides it), no login rate limiting, and no password reset. Treat it as a demo.

## Sharing it temporarily

To let someone outside your network try it, run a Cloudflare tunnel while the server is running:

```bash
cloudflared tunnel --url http://localhost:3000
```

It prints a temporary public `https://` link. Stop the tunnel with Ctrl + C to stop sharing.

## Ideas for next steps

- AI-written explanation of each quote
- A home insurance quote (property risk factors and COPE)
- Login attempt limiting
- Permanent hosting with a persistent database disk
