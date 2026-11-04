const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require("crypto");
// Open our SQLite database (db.js creates the tables if they don't exist yet)
const db = require("./db");

// require brings in tools that Node already has:
// http = web server, fs = read files, path = build file locations, crypto = hashing and random tokens.

// The only folder we are allowed to serve files from
const PUBLIC_DIR = path.join(__dirname, "public");

const PORT = 3000;
// The port number our server listens on (like a door number on your computer).


// Lookup table: tells the browser what kind of file we are sending
const TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
};

// ---------- IN-MEMORY STORAGE (resets every time the server restarts) ----------

//const claims = [];

// Perils (causes of loss) that the policy never covers (slide 7: exclusions)
const EXCLUDED = ["flood", "war", "intentional damage"];

// ---------- HELPER FUNCTIONS ----------

// Send a JSON reply with a status code
function sendJSON(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// Collect the data the browser sent, then pass it to the callback
function readBody(req, callback) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    callback(JSON.parse(body));
  });
}

// Scramble a password with a salt so we never store the real password
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

// Read the session cookie and return the logged-in user (or null).
// One query joins two tables: find the session by its token, then the user it belongs to.
function getUser(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/session=([a-f0-9]+)/);
  if (!match) return null;
  const user = db.prepare(`
    SELECT users.* FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ?    
  `).get(match[1]);
  return user || null;
}
//The ? is a placeholder. The value is passed separately, never glued into the SQL text,
//  which protects against SQL injection (an attack where someone types SQL code into a form field). Always use ? for values.


// Convert one row from the policies table into the object shape our frontend
// and our claim helper functions already expect (camelCase names).
function rowToPolicy(row) {
  return {
    id: row.id,
    userId: row.user_id,
    premises: row.premises,
    effectiveDate: row.effective_date,
    expirationDate: row.expiration_date,
    premium: row.premium,
    decision: row.decision,
    limit: row.limit_amount,
    aggregateLimit: row.aggregate_limit,
    deductible: row.deductible,
    status: row.status,
    paid: row.paid,
    cancellationDate: row.cancellation_date, // null until the policy is cancelled
  };
}

// Convert one row from the claims table into the object shape our frontend expects.
// SQLite stores true/false as 1/0, so we turn "covered" back into a real boolean.
function rowToClaim(row) {
  return {
    id: row.id,
    policyId: row.policy_id,
    userId: row.user_id,
    lossDate: row.loss_date,
    peril: row.peril,
    amount: row.amount,
    covered: row.covered === 1,
    reason: row.reason,
    payout: row.payout,
    status: row.status,
  };
}


// The underwriter: turns risk factors into a premium and a decision
function calculateQuote(data) {
  const base = 600;
  const factors = [];

  if (data.age < 25) {
    factors.push({ label: "Young driver (under 25)", adjust: 0.40 });
  } else if (data.age > 65) {
    factors.push({ label: "Senior driver (over 65)", adjust: 0.15 });
  }

  const violations = data.violations || 0;
  if (violations > 0) {
    factors.push({ label: violations + " traffic violation(s)", adjust: 0.15 * violations });
  }

  if (data.mileage < 7500) {
    factors.push({ label: "Low mileage (under 7,500 a year)", adjust: -0.10 });
  } else if (data.mileage > 15000) {
    factors.push({ label: "High mileage (over 15,000 a year)", adjust: 0.20 });
  }

  if (data.parking === "garage") {
    factors.push({ label: "Garaged overnight", adjust: -0.05 });
  } else if (data.parking === "street") {
    factors.push({ label: "Street parking", adjust: 0.10 });
  }

  const total = factors.reduce((sum, f) => sum + f.adjust, 0);
  const premium = Math.round(base * (1 + total));

  // The underwriter's decision
  let decision = "standard";
  let note = "Standard market: you fit our normal underwriting rules.";

  if (data.age < 16 || violations > 4) {
    decision = "decline";
    note = "We can't offer cover for this risk.";
  } else if (total >= 0.5) {
    decision = "non-standard";
    note = "Non-standard market: higher risk, so expect a higher premium and special terms.";
  }

  return { base, premium, factors, decision, note };
}

// Is this claim covered? Checks status, loss date, and exclusions (slides 6 and 7)
function checkCoverage(policy, claim) {
  if (policy.status !== "active") {
    return { covered: false, reason: "Policy is not active." };
  }
  // Dates in YYYY-MM-DD format can be compared directly
  if (claim.lossDate < policy.effectiveDate || claim.lossDate > policy.expirationDate) {
    return { covered: false, reason: "Loss date is outside the policy period." };
  }
  if (EXCLUDED.includes(claim.peril)) {
    return { covered: false, reason: "'" + claim.peril + "' is an exclusion on this policy." };
  }
  return { covered: true, reason: "Covered." };
}

// How much do we pay? Loss minus deductible, capped by the per-event and yearly limits
function calculatePayout(policy, amount) {
  const afterDeductible = Math.max(amount - policy.deductible, 0);
  const aggregateLeft = policy.aggregateLimit - (policy.paid || 0);
  return Math.min(afterDeductible, policy.limit, aggregateLeft);
}

// ---------- THE SERVER ----------

const server = http.createServer((req, res) => {
  // This function runs every time someone makes a request to our server.

    // SIGNUP BLOCK

  if (req.method === "POST" && req.url === "/api/signup") {
    readBody(req, (data) => {
      if (!data.name || !data.email || !data.password) {
        return sendJSON(res, 400, { error: "Name, email and password are required" });
      }
      // Is this email already in the users table?
      const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(data.email);
      if (exists) {
        return sendJSON(res, 400, { error: "Email already registered" });
      }
      const salt = crypto.randomBytes(16).toString("hex");
      // INSERT adds a new row. SQLite picks the id for us.
      const result = db.prepare(
        "INSERT INTO users (name, email, salt, hash) VALUES (?, ?, ?, ?)"
      ).run(data.name, data.email, salt, hashPassword(data.password, salt));
      // Number() converts the new row id into a normal number for JSON
      sendJSON(res, 201, { id: Number(result.lastInsertRowid), name: data.name, email: data.email });
    });
    return;
  }

    // LOGIN BLOCK

  if (req.method === "POST" && req.url === "/api/login") {
    readBody(req, (data) => {
      // Look the user up by email
      const user = db.prepare("SELECT * FROM users WHERE email = ?").get(data.email);
      if (!user || hashPassword(data.password, user.salt) !== user.hash) {
        return sendJSON(res, 401, { error: "Wrong email or password" });
      }
      // Create a session token and SAVE it in the sessions table
      const token = crypto.randomBytes(24).toString("hex");
      db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)").run(token, user.id);
      res.setHeader("Set-Cookie", "session=" + token + "; HttpOnly; Path=/");
      sendJSON(res, 200, { id: user.id, name: user.name, email: user.email });
    });
    return;
  }

  // WHO AM I BLOCK

  if (req.method === "GET" && req.url === "/api/me") {
    const user = getUser(req);
    if (!user) {
      return sendJSON(res, 401, { error: "Not logged in" });
    }
    return sendJSON(res, 200, { id: user.id, name: user.name, email: user.email });
  }

  // LOGOUT BLOCK

  if (req.method === "POST" && req.url === "/api/logout") {
    const cookie = req.headers.cookie || "";
    const match = cookie.match(/session=([a-f0-9]+)/);
    if (match) {
      // Remove the session row, so the old cookie stops working
      db.prepare("DELETE FROM sessions WHERE token = ?").run(match[1]);
    }
    res.setHeader("Set-Cookie", "session=; HttpOnly; Path=/; Max-Age=0");
    return sendJSON(res, 200, { ok: true });
  }

  // QUOTE BLOCK

  if (req.method === "POST" && req.url === "/api/quote") {
    const user = getUser(req);
    if (!user) {
      return sendJSON(res, 401, { error: "Please log in first" });
    }
    readBody(req, (data) => {
      if (!data.age || data.mileage === undefined || !data.parking) {
        return sendJSON(res, 400, { error: "Age, mileage and parking are required" });
      }
      sendJSON(res, 200, calculateQuote(data));
    });
    return;
  }

    // POLICY BLOCK (buy a policy)

  if (req.method === "POST" && req.url === "/api/policy") {
    const user = getUser(req);
    if (!user) {
      return sendJSON(res, 401, { error: "Please log in first" });
    }
    readBody(req, (data) => {
      if (!data.address) {
        return sendJSON(res, 400, { error: "Address is required" });
      }
      // The server recalculates the quote itself and never trusts a price from the browser
      const quote = calculateQuote(data);
      if (quote.decision === "decline") {
        return sendJSON(res, 400, { error: quote.note });
      }

      const start = new Date();
      const end = new Date();
      end.setFullYear(end.getFullYear() + 1);

      // INSERT one new row into the policies table.
      // The paid column is left out, so it uses its default of 0.
      const result = db.prepare(`
        INSERT INTO policies
          (user_id, premises, effective_date, expiration_date, premium,
           decision, limit_amount, aggregate_limit, deductible, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        user.id,
        data.address,
        start.toISOString().slice(0, 10),
        end.toISOString().slice(0, 10),
        quote.premium,
        quote.decision,
        50000,                                          // limit per event
        100000,                                         // yearly (aggregate) limit
        quote.decision === "standard" ? 500 : 1000,     // deductible
        "active"
      );

      // Read the new row back, convert it, and send it to the browser
      const row = db.prepare("SELECT * FROM policies WHERE id = ?").get(Number(result.lastInsertRowid));
      sendJSON(res, 201, rowToPolicy(row));
    });
    return;
  }


    // LIST POLICIES BLOCK (only the logged-in user's policies)

  if (req.method === "GET" && req.url === "/api/policies") {
    const user = getUser(req);
    if (!user) {
      return sendJSON(res, 401, { error: "Please log in first" });
    }
    // .all() returns every matching row. The WHERE clause keeps it to this user's policies.
    const rows = db.prepare("SELECT * FROM policies WHERE user_id = ? ORDER BY id").all(user.id);
    return sendJSON(res, 200, rows.map(rowToPolicy));
  }


    // CANCEL POLICY BLOCK

  if (req.method === "POST" && req.url === "/api/policy/cancel") {
    const user = getUser(req);
    if (!user) {
      return sendJSON(res, 401, { error: "Please log in first" });
    }
    readBody(req, (data) => {
      // The policy must exist AND belong to the logged-in user
      const row = db.prepare("SELECT * FROM policies WHERE id = ? AND user_id = ?").get(data.policyId, user.id);
      if (!row) {
        return sendJSON(res, 404, { error: "Policy not found" });
      }
      if (row.status !== "active") {
        return sendJSON(res, 400, { error: "This policy is already cancelled." });
      }
      // Mark it cancelled and record today's date (slide 6: cancellation date)
      const today = new Date().toISOString().slice(0, 10);
      db.prepare("UPDATE policies SET status = 'cancelled', cancellation_date = ? WHERE id = ?")
        .run(today, row.id);
      const updated = db.prepare("SELECT * FROM policies WHERE id = ?").get(row.id);
      sendJSON(res, 200, rowToPolicy(updated));
    });
    return;
  }

    // CLAIM BLOCK (file a claim)

  if (req.method === "POST" && req.url === "/api/claim") {
    const user = getUser(req);
    if (!user) {
      return sendJSON(res, 401, { error: "Please log in first" });
    }
    readBody(req, (data) => {
      // The policy must exist AND belong to the logged-in user
      const row = db.prepare("SELECT * FROM policies WHERE id = ? AND user_id = ?").get(data.policyId, user.id);
      if (!row) {
        return sendJSON(res, 404, { error: "Policy not found" });
      }
      const policy = rowToPolicy(row);

      if (!data.lossDate || !data.peril || !data.amount) {
        return sendJSON(res, 400, { error: "Loss date, cause and amount are required" });
      }

      // Build the claim details we want to check
      const claim = {
        lossDate: data.lossDate,
        peril: data.peril.toLowerCase(),
        amount: data.amount,
      };

      // Check coverage (dates, status, exclusions), then work out the payout
      const result = checkCoverage(policy, claim);
      const payout = result.covered ? calculatePayout(policy, claim.amount) : 0;
      const status = result.covered ? "approved" : "denied";

      // Save the claim as a new row. covered is stored as 1 (yes) or 0 (no).
      const inserted = db.prepare(`
        INSERT INTO claims
          (policy_id, user_id, loss_date, peril, amount, covered, reason, payout, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        policy.id, user.id, claim.lossDate, claim.peril, claim.amount,
        result.covered ? 1 : 0, result.reason, payout, status
      );

      // Add this payout to the policy's running total (for the yearly limit)
      db.prepare("UPDATE policies SET paid = paid + ? WHERE id = ?").run(payout, policy.id);

      // Read the saved claim back, convert it, and send it to the browser
      const saved = db.prepare("SELECT * FROM claims WHERE id = ?").get(Number(inserted.lastInsertRowid));
      sendJSON(res, 201, rowToClaim(saved));
    });
    return;
  }

   // LIST CLAIMS BLOCK (only the logged-in user's claims)

  if (req.method === "GET" && req.url === "/api/claims") {
    const user = getUser(req);
    if (!user) {
      return sendJSON(res, 401, { error: "Please log in first" });
    }
    const rows = db.prepare("SELECT * FROM claims WHERE user_id = ? ORDER BY id").all(user.id);
    return sendJSON(res, 200, rows.map(rowToClaim));
  }

  // ---------- FILE SERVING (everything that is not an API) ----------

  

  // Clean up the address: drop any "?something" on the end and decode symbols like %20.
  // decodeURIComponent throws an error on broken input, so we catch it and reply 400.
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split("?")[0]);
  } catch (e) {
    res.writeHead(400);
    return res.end("Bad request");
  }

  // A null character ("\0") is never valid in a file name and can crash file reading
  if (urlPath.includes("\0")) {
    res.writeHead(400);
    return res.end("Bad request");
  }

  // "/" means the home page, so we send index.html
  if (urlPath === "/") urlPath = "/index.html";

  // Build the full location of the file. path.join resolves any ".." parts,
  // so "/../server.js" would turn into the real location of server.js, OUTSIDE public/.
  const filePath = path.join(PUBLIC_DIR, urlPath);

  // The safety check: the final path must still be inside the public folder.
  // If it is not, refuse the request. (path.sep is "\" on Windows, "/" on Mac and Linux.)
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    // File not found: reply 404
    if (err) {
      res.writeHead(404);
      res.end("Page not found");
      return;
    }
    // Tell the browser what type of file this is (HTML, CSS or JavaScript)
    const type = TYPES[path.extname(filePath)] || "text/plain";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log("Server is running on http://localhost:" + PORT);
});