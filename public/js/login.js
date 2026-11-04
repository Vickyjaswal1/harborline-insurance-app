const tabLogin = document.getElementById("tabLogin");
const tabSignup = document.getElementById("tabSignup");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const indicator = document.getElementById("tabIndicator");

function moveIndicator() {
  const active = tabLogin.getAttribute("aria-selected") === "true" ? tabLogin : tabSignup;
  indicator.style.width = active.offsetWidth + "px";
  indicator.style.transform = "translateX(" + active.offsetLeft + "px)";
}

function show(which) {
  const isLogin = which === "login";
  loginForm.hidden = !isLogin;
  signupForm.hidden = isLogin;
  tabLogin.setAttribute("aria-selected", isLogin);
  tabSignup.setAttribute("aria-selected", !isLogin);
  moveIndicator();
}

tabLogin.onclick = () => show("login");
tabSignup.onclick = () => show("signup");

document.fonts.ready.then(moveIndicator);
window.addEventListener("resize", moveIndicator);



//Login form submission
const formError = document.getElementById("formError");

function showError(message) {
  formError.textContent = message;
}

loginForm.onsubmit = async (e) => {

  //e.preventDefault() stops the browser’s default form behavior, which is reloading the page.

  e.preventDefault();
  showError("");
  try {
    await api("/api/login", "POST", {
      email: document.getElementById("loginEmail").value,
      password: document.getElementById("loginPassword").value,
    });
    window.location.href = "/app.html";
  } catch (err) {
    showError(err.message);
  }
};

//signup form submission
signupForm.onsubmit = async (e) => {
  e.preventDefault();
  showError("");
  const email = document.getElementById("signupEmail").value;
  const password = document.getElementById("signupPassword").value;
  try {
    await api("/api/signup", "POST", {
      name: document.getElementById("signupName").value,
      email: email,
      password: password,
    });
    await api("/api/login", "POST", { email: email, password: password });
    window.location.href = "/app.html";
  } catch (err) {
    showError(err.message);
  }
};