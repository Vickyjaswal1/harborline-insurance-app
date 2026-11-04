// =====================================================
// app.js: logic for the main app page (app.html)
// =====================================================

// ---------- TABS (Quote / Policies / Claims) ----------

// Grab all three tab buttons from the page
const tabs = document.querySelectorAll(".nav-tab");

// Show one panel and hide the others
function showTab(name) {
  // Mark the clicked tab as selected (this also changes its style in CSS)
  tabs.forEach((t) => t.setAttribute("aria-selected", t.dataset.tab === name));
  // Hide every panel except the one we want
  ["quote", "policies", "claims"].forEach((n) => {
    document.getElementById("panel-" + n).hidden = n !== name;
  });
  // NEW: every time the Policies tab opens, fetch the latest list from the server
  if (name === "policies") loadPolicies();
}

// When a tab is clicked, show its panel
tabs.forEach((t) => (t.onclick = () => showTab(t.dataset.tab)));

// ---------- SIGN OUT + WHO IS LOGGED IN ----------

// Sign out: tell the server, then go back to the login page
document.getElementById("logoutBtn").onclick = async () => {
  await api("/api/logout", "POST");
  window.location.href = "/";
};

// Ask the server who is logged in. If nobody is, send them to the login page.
api("/api/me", "GET")
  .then((user) => {
    document.getElementById("userName").textContent = user.name;
  })
  .catch(() => {
    window.location.href = "/";
  });

// ---------- QUOTE PANEL ----------

// Each slider is paired with the <output> that shows its current value
const sliders = [
  { id: "age", out: "ageOut" },
  { id: "violations", out: "violationsOut" },
  { id: "mileage", out: "mileageOut" },
];

// While a slider moves, update the number shown beside it
sliders.forEach((s) => {
  const input = document.getElementById(s.id);
  const out = document.getElementById(s.out);
  input.oninput = () => {
    // toLocaleString() adds the thousands comma: 10000 becomes 10,000
    out.textContent = Number(input.value).toLocaleString();
  };
});

// Helper: format a number as money, e.g. 1200 becomes "$1,200"
function money(n) {
  return "$" + n.toLocaleString();
}

// Animate a number from 0 up to its final value, e.g. $0 -> $510.
// requestAnimationFrame runs our code once per screen refresh, so the motion is smooth.
function countUp(element, target) {
  // If the person asked for reduced motion, just show the final number
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    element.textContent = money(target);
    return;
  }
  const duration = 700; // milliseconds
  const start = performance.now();

  function step(now) {
    // progress goes from 0 to 1 over the duration
    const progress = Math.min((now - start) / duration, 1);
    // ease-out: fast at first, slowing down near the end
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = money(Math.round(target * eased));
    if (progress < 1) requestAnimationFrame(step); // keep going until finished
  }
  requestAnimationFrame(step);
}

// Draw the receipt from the quote the server sent back.
// "q" is the quote object, and it only exists INSIDE this function.
function renderQuote(q) {
  const list = document.getElementById("factors");
  list.innerHTML = ""; // clear the previous receipt lines

  // First line is the starting price. Then one line per risk factor.
  const rows = [{ label: "Starting price", amount: q.base, plain: true }];
  q.factors.forEach((f) => {
    // Turn the percentage into dollars: 40% of $600 = $240
    rows.push({ label: f.label, amount: Math.round(q.base * f.adjust) });
  });

  // Build one <li> for each row
  rows.forEach((r, i) => {
    const li = document.createElement("li");
    li.className = "factor";
    li.style.setProperty("--i", i); // tells the CSS which position this line is in
    const name = document.createElement("span");
    name.textContent = r.label;
    const amt = document.createElement("span");
    if (r.plain) {
      amt.textContent = money(r.amount); // starting price: no plus or minus sign
    } else {
      // Surcharges get "+" and a red class, discounts get "−" and a green class
      amt.textContent = (r.amount >= 0 ? "+" : "\u2212") + money(Math.abs(r.amount));
      amt.className = r.amount >= 0 ? "up" : "down";
    }
    li.append(name, amt);
    list.append(li);
  });

  // Show the total premium (or a dash if the risk was declined)
  const labels = { standard: "Standard market", "non-standard": "Non-standard market", decline: "Not offered" };

    // Declined risks show a dash. Everything else counts up to the premium.
  const premiumEl = document.getElementById("premium");
  if (q.decision === "decline") {
    premiumEl.textContent = "\u2014";
  } else {
    countUp(premiumEl, q.premium);
  }

  // Show the underwriter's decision and the explanation note
  const decision = document.getElementById("decision");
  decision.textContent = labels[q.decision];
  decision.dataset.decision = q.decision; // CSS uses this to pick the color
  document.getElementById("note").textContent = q.note;

  // Show the buy box only if the risk was NOT declined
  document.getElementById("buyBox").hidden = q.decision === "decline";
}

// Remembers the answers behind the quote on screen, so "Buy" uses the same ones
let lastInput = null;
const quoteForm = document.getElementById("quoteForm");

// When "Calculate my quote" is clicked
quoteForm.onsubmit = async (e) => {
  e.preventDefault(); // stop the page from reloading
  const btn = document.getElementById("calcBtn");
  btn.disabled = true; // prevent double clicks while waiting
  btn.textContent = "Calculating...";
  try {
    // Collect the answers as numbers
    lastInput = {
      age: Number(document.getElementById("age").value),
      violations: Number(document.getElementById("violations").value),
      mileage: Number(document.getElementById("mileage").value),
      parking: quoteForm.parking.value, // the selected radio button
    };
    // Ask the server for the quote, then draw it
    const quote = await api("/api/quote", "POST", lastInput);
    renderQuote(quote);
  } catch (err) {
    // For example "Please log in first": show it in the note area
    document.getElementById("note").textContent = err.message;
  } finally {
    // Runs whether it worked or failed: re-enable the button
    btn.disabled = false;
    btn.textContent = "Calculate my quote";
  }
};

// If the user changes any answer after calculating, hide the buy box,
// so the price they see is always the price they get.
quoteForm.addEventListener("input", () => {
  document.getElementById("buyBox").hidden = true;
});

// ---------- BUY BUTTON ----------

document.getElementById("buyBtn").onclick = async () => {
  const buyError = document.getElementById("buyError");
  const address = document.getElementById("address").value.trim();
  buyError.textContent = "";

  // The policy needs an address (the "premises" from the slides)
  if (!address) {
    buyError.textContent = "Enter the address you want to insure.";
    return;
  }

  const btn = document.getElementById("buyBtn");
  btn.disabled = true;
  try {
    // Send the saved quote answers plus the address
    await api("/api/policy", "POST", { ...lastInput, address: address });
    // Open the Policies tab. showTab loads the fresh list by itself.
    showTab("policies");
  } catch (err) {
    buyError.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
};

// ---------- POLICIES SCREEN ----------

// Helper: create an element with a CSS class and some text.
// We use textContent (not innerHTML) so text a user typed, like an address,
// can never be run as code.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Helper: build one fact block = small label, big value, short explanation
function fact(label, value, hint) {
  const box = el("div", "fact");
  box.append(
    el("span", "fact-label", label),
    el("strong", "fact-value", value),
    el("span", "fact-hint", hint)
  );
  return box;
}

// Build the visual block for a single policy object from the server

function buildPolicy(p) {
  const item = el("li", "policy");
  item.dataset.status = p.status; // CSS uses this to grey out cancelled policies

  // Top row: policy number, address, and two badges
  const head = el("div", "policy-head");
  head.append(
    el("h2", "font-[family-name:var(--font-head)] text-2xl font-semibold", "Policy #" + p.id),
    el("span", "", p.premises),
    el("span", "badge badge-" + p.status, p.status), // badge-active or badge-cancelled
    el("span", "badge", p.decision === "standard" ? "Standard market" : "Non-standard market")
  );

  // The facts grid: each one is a term from the slides in plain words
  const facts = el("div", "policy-facts");
  facts.append(
    fact("Premium", money(p.premium) + " / year", "What you pay for this cover."),
    fact("Deductible", money(p.deductible), "You pay this first on any claim."),
    fact("Limit per event", money(p.limit), "The most we pay for one event."),
    fact("Yearly limit", money(p.aggregateLimit), "The most we pay across the whole year."),
    fact("Paid out so far", money(p.paid || 0), "Claims paid on this policy."),
    fact("Starts", p.effectiveDate, "Cover begins (effective date)."),
    fact("Ends", p.expirationDate, "Cover ends (expiration date).")
  );
  // Only cancelled policies show the cancellation date
  if (p.cancellationDate) {
    facts.append(fact("Cancelled on", p.cancellationDate, "Cover stopped on this date (cancellation date)."));
  }

  item.append(head, facts);

  // Only active policies get a cancel button
  if (p.status === "active") {
    const btn = el("button", "cancel-btn", "Cancel this policy");
    btn.onclick = () => cancelPolicy(p.id);
    item.append(btn);
  }
  return item;
}

// Ask the server for this user's policies and draw them
async function loadPolicies() {
  const list = document.getElementById("policyList");
  const empty = document.getElementById("policiesEmpty");
  try {
    const policies = await api("/api/policies", "GET");
    list.innerHTML = "";                 // clear the old list first
    empty.hidden = policies.length > 0;  // show the empty message only if there are none
    // .slice().reverse() puts the newest policy at the top
    policies.slice().reverse().forEach((p) => list.append(buildPolicy(p)));
  } catch (err) {
    empty.hidden = false;
    empty.textContent = err.message;     // for example "Please log in first"
  }
}


// ---------- CLAIMS SCREEN ----------

// Remember the user's policies so we can look up the deductible later
let claimPolicies = [];

// Load the policies into the dropdown each time the Claims tab opens.
// We add our OWN click listener here, so the existing showTab code stays untouched.
tabs.forEach((t) =>
  t.addEventListener("click", () => {
    if (t.dataset.tab === "claims") loadClaimForm();
  })
);

async function loadClaimForm() {
  const select = document.getElementById("claimPolicy");
  const form = document.getElementById("claimForm");
  const none = document.getElementById("claimsNoPolicy");
  try {
    claimPolicies = await api("/api/policies", "GET");
  } catch (err) {
    claimPolicies = [];
  }

  // Fill the dropdown with one option per policy
  select.innerHTML = "";
  claimPolicies.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = "Policy #" + p.id + ": " + p.premises;
    select.append(opt);
  });

  // No policies: hide the form and show the "buy one first" message
  none.hidden = claimPolicies.length > 0;
  form.hidden = claimPolicies.length === 0;

  // Default the date to today. We use the UTC date because the server
  // also uses it for the policy start date, so the two always agree.
  document.getElementById("lossDate").value = new Date().toISOString().slice(0, 10);
}

// Helper: one line of the working, e.g. "Your deductible  −$500"
function workingLine(label, value) {
  const li = el("li", "factor");
  li.append(el("span", "", label), el("span", "", value));
  return li;
}

// Draw the outcome of a claim, including the working
function renderClaimResult(claim, policy) {
  const box = document.getElementById("claimResult");
  box.innerHTML = "";               // clear any previous result
  box.hidden = false;
  box.dataset.status = claim.status; // CSS colors the left edge from this

  // Headline: approved or denied
  box.append(el("h2", "result-title", claim.covered ? "Claim approved" : "Claim denied"));
  // The reason from the server (for example "Loss date is outside the policy period.")
  box.append(el("p", "mt-2", claim.reason));

  // Denied claims pay nothing, so there is no maths to show
  if (!claim.covered) {
    box.append(el("p", "mt-4 text-sm text-[color:var(--color-muted)]",
      "Nothing is paid on this claim. Check the date and cause, or look at your policy terms."));
    return;
  }

  // Approved: show how the payout was worked out (the formula from slide 7)
  const deductible = Math.min(policy.deductible, claim.amount);
  const afterDeductible = Math.max(claim.amount - policy.deductible, 0);

  const list = el("ul", "mt-5");
  list.append(workingLine("Your loss", money(claim.amount)));
  list.append(workingLine("Your deductible (you pay this first)", "\u2212" + money(deductible)));

  // If the payout is smaller than loss minus deductible, a limit held it back
  if (claim.payout < afterDeductible) {
    list.append(workingLine("Held back by your policy limit", "\u2212" + money(afterDeductible - claim.payout)));
  }
  box.append(list);

  // The final amount, styled like the receipt total on the quote screen
  const total = el("div", "receipt-total");
  total.append(el("span", "", "We pay you"), el("strong", "", money(claim.payout)));
  box.append(total);
}

// When "File claim" is pressed
document.getElementById("claimForm").onsubmit = async (e) => {
  e.preventDefault(); // stop the page reloading
  const error = document.getElementById("claimError");
  const btn = document.getElementById("claimBtn");
  error.textContent = "";
  btn.disabled = true;
  btn.textContent = "Checking...";
  try {
    // Which policy did the user choose? Find it in the list we saved earlier.
    const policyId = Number(document.getElementById("claimPolicy").value);
    const policy = claimPolicies.find((p) => p.id === policyId);

    // Send the claim to the server, which does all the real checking
    const claim = await api("/api/claim", "POST", {
      policyId: policyId,
      lossDate: document.getElementById("lossDate").value,
      peril: document.getElementById("peril").value,
      amount: Number(document.getElementById("amount").value),
    });
    renderClaimResult(claim, policy);
    loadClaimHistory(); // refresh the history list so the new claim appears
  } catch (err) {
    error.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "File claim";
  }
};


// ---------- CLAIMS HISTORY ----------

// Reload the history every time the Claims tab opens
tabs.forEach((t) =>
  t.addEventListener("click", () => {
    if (t.dataset.tab === "claims") loadClaimHistory();
  })
);

// Build one row for a single claim object from the server
function buildClaimRow(c) {
  const row = el("li", "claim-row");
  row.dataset.status = c.status; // CSS colors the left edge from this

  // Left side: claim number, cause, date and amount, plus a status badge
  const details = el("div", "");
  details.append(
    el("strong", "", "Claim #" + c.id + " \u00B7 " + c.peril),
    el("span", "badge badge-" + c.status + " ml-2", c.status)
  );
  details.append(
    el("div", "text-sm text-[color:var(--color-muted)]",
      "Policy #" + c.policyId + " \u00B7 loss on " + c.lossDate + " \u00B7 " + money(c.amount) + " claimed")
  );
  // For denied claims, show the reason so the customer knows why
  if (!c.covered) {
    details.append(el("div", "text-sm", c.reason));
  }

  // Right side: how much was paid
  const payout = el("div", "claim-payout", c.covered ? money(c.payout) : "\u2014");

  row.append(details, payout);
  return row;
}

// Ask the server for this user's claims and draw them
async function loadClaimHistory() {
  const list = document.getElementById("claimList");
  const empty = document.getElementById("claimsEmpty");
  try {
    const claims = await api("/api/claims", "GET");
    list.innerHTML = "";               // clear the old list first
    empty.hidden = claims.length > 0;  // show "No claims filed yet" only when empty
    // .slice().reverse() puts the newest claim at the top
    claims.slice().reverse().forEach((c) => list.append(buildClaimRow(c)));
  } catch (err) {
    empty.hidden = false;
    empty.textContent = err.message;
  }
}


// ---------- CANCEL A POLICY ----------

async function cancelPolicy(id) {
  // confirm() shows a built-in "OK / Cancel" box, so nobody cancels by accident
  if (!confirm("Cancel policy #" + id + "? Claims filed after cancelling will be denied.")) return;
  try {
    await api("/api/policy/cancel", "POST", { policyId: id });
    loadPolicies(); // redraw the list so the badge and button update
  } catch (err) {
    alert(err.message); // for example "This policy is already cancelled."
  }
}