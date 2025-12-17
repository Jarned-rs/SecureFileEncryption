// --------------------------------------------------------------------------
// IMPORT MSAL.JS
// --------------------------------------------------------------------------
import { PublicClientApplication } 
  from "https://alcdn.msauth.net/browser/2.38.0/js/msal-browser.esm.min.js";

// --------------------------------------------------------------------------
// MSAL CONFIG
// --------------------------------------------------------------------------
const msalConfig = {
  auth: {
    clientId: "125e8766-e691-4734-86e8-83d9a3e603b3",
    // IMPORTANT: Set this to the exact URL of your page (GitHub Pages site path).
    // Example: "https://jarned-rs.github.io/SecureFileEncryption/"
    redirectUri: "https://jarned-rs.github.io/SecureFileEncryption/"
  },
  cache: {
    cacheLocation: "localStorage"
  }
};

const msalInstance = new PublicClientApplication(msalConfig);
let accessToken = null;

const SCOPES = ["Files.ReadWrite"];

// --------------------------------------------------------------------------
// DOM READY: Hook up buttons safely
// --------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const signinBtn = document.getElementById("signin");
  const signoutBtn = document.getElementById("signout");
  const app = document.getElementById("app");
  const uploadBtn = document.getElementById("uploadBtn");

  // Guard against missing elements
  if (!signinBtn || !signoutBtn || !app || !uploadBtn) {
    console.error("One or more UI elements not found. Check your IDs.");
    return;
  }

  signinBtn.addEventListener("click", login);
  signoutBtn.addEventListener("click", logout);
  uploadBtn.addEventListener("click", uploadEncryptedFile);

  // If already signed in, try to get a token silently
  initializeSession();
});

// --------------------------------------------------------------------------
// SESSION INIT: Try silent token if account exists
// --------------------------------------------------------------------------
async function initializeSession() {
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) return;

  try {
    const tokenResponse = await msalInstance.acquireTokenSilent({
      scopes: SCOPES,
      account: accounts[0]
    });

    accessToken = tokenResponse.accessToken;
    showApp();
    loadFiles();
  } catch (silentErr) {
    console.warn("Silent token acquisition failed, requiring interactive login.", silentErr);
  }
}

// --------------------------------------------------------------------------
// LOGIN & LOGOUT
// --------------------------------------------------------------------------
async function login() {
  try {
    // 1) Sign in interactively
    const loginResponse = await msalInstance.loginPopup({
      scopes: SCOPES
    });

    // 2) Get an access token (loginPopup does NOT return a token)
    const tokenResponse = await msalInstance.acquireTokenPopup({
      scopes: SCOPES,
      account: loginResponse.account
    });

    accessToken = tokenResponse.accessToken;

    showApp();
    await loadFiles();
  } catch (err) {
    alert("Login failed: " + err.message);
    console.error(err);
  }
}

async function logout() {
  try {
    await msalInstance.logoutPopup();
  } finally {
    hideApp();
    location.reload();
  }
}

// --------------------------------------------------------------------------
// UI HELPERS
// --------------------------------------------------------------------------
function showApp() {
  document.getElementById("signin").classList.add("hidden");
  document.getElementById("signout").classList.remove("hidden");
  document.getElementById("app").classList.remove("hidden");
}

function hideApp() {
  document.getElementById("signin").classList.remove("hidden");
  document.getElementById("signout").classList.add("hidden");
  document.getElementById("app").classList.add("hidden");
}

// --------------------------------------------------------------------------
// CRYPTOGRAPHY — AES-GCM ENCRYPTION
// --------------------------------------------------------------------------
async function deriveKey(password) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("onedrive-salt"),
      iterations: 100_000,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptFile(password, fileBytes) {
  const key = await deriveKey(password);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    fileBytes
  );

  const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.byteLength);
  return combined;
}

async function decryptFile(password, encryptedBytes) {
  const key = await deriveKey(password);
  const iv = encryptedBytes.slice(0, 12);
  const data = encryptedBytes.slice(12);

  return await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );
}

// --------------------------------------------------------------------------
// ONEDRIVE API — UPLOAD, LIST, DOWNLOAD
// --------------------------------------------------------------------------
async function uploadEncryptedFile() {
  const fileInput = document.getElementById("fileInput");
  const passwordInput = document.getElementById("password");

  const file = fileInput.files[0];
  const password = passwordInput.value;

  if (!file) {
    alert("Choose a file first.");
    return;
  }
  if (!password) {
    alert("Enter a password first.");
    return;
  }
  if (!accessToken) {
    alert("Please sign in first.");
    return;
  }

  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const encryptedBytes = await encryptFile(password, fileBytes);

  const uploadUrl =
    "https://graph.microsoft.com/v1.0/me/drive/root:/SecureEncryptedFiles/" +
    encodeURIComponent(file.name + ".enc") +
    ":/content";

  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream"
    },
    body: encryptedBytes
  });

  if (!res.ok) {
    const text = await res.text();
    alert("Upload failed: " + text);
    return;
  }

  alert("Encrypted file uploaded.");
  loadFiles();
}

async function loadFiles() {
  if (!accessToken) return;

  const listUrl =
    "https://graph.microsoft.com/v1.0/me/drive/root:/SecureEncryptedFiles:/children";

  const res = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  const fileList = document.getElementById("fileList");
  fileList.innerHTML = "";

  if (!res.ok) {
    const text = await res.text();
    console.error("List failed:", text);
    return;
  }

  const data = await res.json();
  if (!data.value) return;

  data.value.forEach(file => {
    const li = document.createElement("li");
    li.textContent = file.name;

    const btn = document.createElement("button");
    btn.textContent = "Download & Decrypt";
    btn.className = "btn";
    btn.style.marginLeft = "10px";

    btn.onclick = () => downloadAndDecrypt(file.name);
    li.appendChild(btn);
    fileList.appendChild(li);
  });
}

async function downloadAndDecrypt(filename) {
  const password = document.getElementById("password").value;

  if (!password) {
    alert("Enter your password first.");
    return;
  }
  if (!accessToken) {
    alert("Please sign in first.");
    return;
  }

  const downloadUrl =
    "https://graph.microsoft.com/v1.0/me/drive/root:/SecureEncryptedFiles/" +
    encodeURIComponent(filename) +
    ":/content";

  const res = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!res.ok) {
    const text = await res.text();
    alert("Download failed: " + text);
    return;
  }

  const encryptedBytes = new Uint8Array(await res.arrayBuffer());

  try {
    const decrypted = await decryptFile(password, encryptedBytes);
    const blob = new Blob([decrypted]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename.replace(".enc", "");
    a.click();
  } catch (err) {
    alert("Incorrect password or corrupted file.");
    console.error(err);
  }
}


