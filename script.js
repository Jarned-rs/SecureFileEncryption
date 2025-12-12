// ===== MSAL CONFIG =====
const msalConfig = {
  auth: {
    clientId: "YOUR_CLIENT_ID",  // Azure app ID
    redirectUri: window.location.origin
  },
  cache: {
    cacheLocation: "localStorage"
  }
};

const msalInstance = new msal.PublicClientApplication(msalConfig);
const loginRequest = { scopes: ["User.Read", "Files.ReadWrite.All"] };

// ===== LOGIN =====
document.getElementById("signInBtn").onclick = () => {
  msalInstance.loginPopup(loginRequest)
    .then(loginResponse => {
      console.log("Logged in:", loginResponse);
      refreshFileList();
    });
};

// ===== GRAPH API HELPERS =====
async function getAccessToken() {
  const response = await msalInstance.acquireTokenSilent(loginRequest)
    .catch(() => msalInstance.acquireTokenPopup(loginRequest));
  return response.accessToken;
}

async function callGraph(endpoint, method="GET", body=null) {
  const token = await getAccessToken();
  return fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body && { "Content-Type": "application/octet-stream" })
    },
    body
  }).then(res => res.ok ? res.json() : Promise.reject(res));
}

// ===== FILE LIST =====
async function refreshFileList() {
  const data = await callGraph(`/me/drive/root:/SecureEncryptedFiles:/children`);
  const select = document.getElementById("fileList");
  select.innerHTML = "";
  data.value.forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = item.name;
    select.appendChild(opt);
  });
}

// ===== ENCRYPT & UPLOAD =====
async function encryptAndUpload() {
  const file = document.getElementById("encryptFileInput").files[0];
  const password = document.getElementById("encryptPassword").value;
  if (!file || !password) return alert("Select file + password");

  const buffer = await file.arrayBuffer();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    buffer
  );

  const combined = new Uint8Array([...salt, ...iv, ...new Uint8Array(encrypted)]);
  await callGraph(`/me/drive/root:/SecureEncryptedFiles/${file.name}.enc:/content`, "PUT", combined);
  alert("Uploaded!");
  refreshFileList();
}

// ===== DOWNLOAD & DECRYPT =====
async function downloadAndDecrypt() {
  const selectedId = document.getElementById("fileList").value;
  const password = document.getElementById("decryptPassword").value;
  if (!selectedId || !password) return alert("Select + password");

  const token = await getAccessToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${selectedId}/content`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const arrayBuffer = await res.arrayBuffer();

  const salt = arrayBuffer.slice(0, 16);
  const iv = arrayBuffer.slice(16, 28);
  const ciphertext = arrayBuffer.slice(28);

  const key = await deriveKey(password, salt);
  const plaintextBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);

  const blob = new Blob([plaintextBuffer]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "decrypted";
  a.click();
}

// ===== KEY DERIVATION =====
async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// ===== EVENT LISTENERS =====
document.getElementById("encryptBtn").onclick = encryptAndUpload;
document.getElementById("decryptBtn").onclick = downloadAndDecrypt;
