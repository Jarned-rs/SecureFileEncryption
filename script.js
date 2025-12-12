// ===== CONFIG =====
const msalConfig = {
  auth: {
    clientId: "YOUR_CLIENT_ID", // Replace with your Azure app client ID
    redirectUri: window.location.origin
  }
};

const msalInstance = new msal.PublicClientApplication(msalConfig);
const loginRequest = { scopes: ["User.Read", "Files.ReadWrite.All"] };
const oneDriveFolder = "SecureEncryptedFiles";

// ===== LOGIN =====
document.getElementById("signInBtn").onclick = async () => {
  try {
    await msalInstance.loginPopup(loginRequest);
    alert("Signed in!");
    await refreshFileList();
  } catch (err) {
    console.error(err);
    alert("Login failed");
  }
};

// ===== GET ACCESS TOKEN =====
async function getAccessToken() {
  try {
    const tokenResponse = await msalInstance.acquireTokenSilent(loginRequest);
    return tokenResponse.accessToken;
  } catch {
    const tokenResponse = await msalInstance.acquireTokenPopup(loginRequest);
    return tokenResponse.accessToken;
  }
}

// ===== GRAPH API CALL =====
async function callGraph(endpoint, method="GET", body=null) {
  const token = await getAccessToken();
  const headers = { Authorization: `Bearer ${token}` };
  if (body) headers["Content-Type"] = "application/octet-stream";

  const res = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
    method, headers, body
  });

  if (!res.ok) throw new Error(`Graph API error: ${res.status}`);
  if (method === "GET") return res.json ? await res.json() : await res.arrayBuffer();
  return await res.json();
}

// ===== ENCRYPTION HELPERS =====
async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt","decrypt"]
  );
}

function concatBuffers(buffers) {
  let total = buffers.reduce((acc,b) => acc + b.byteLength,0);
  let temp = new Uint8Array(total);
  let offset=0;
  for(let b of buffers) {
    temp.set(new Uint8Array(b), offset);
    offset+=b.byteLength;
  }
  return temp.buffer;
}

// ===== ENCRYPT & UPLOAD =====
async function encryptAndUpload() {
  const fileInput = document.getElementById("encryptFileInput");
  const password = document.getElementById("encryptPassword").value;
  if (!fileInput.files.length || !password) return alert("Select file and enter password");

  const file = fileInput.files[0];
  const fileBuffer = await file.arrayBuffer();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);

  const ciphertext = await crypto.subtle.encrypt({ name:"AES-GCM", iv }, key, fileBuffer);
  const combined = concatBuffers([salt.buffer, iv.buffer, ciphertext]);

  await callGraph(`/me/drive/root:/${oneDriveFolder}/${file.name}.enc:/content`, "PUT", combined);
  alert("Encrypted file uploaded!");
  await refreshFileList();
}

// ===== DOWNLOAD & DECRYPT =====
async function downloadAndDecrypt() {
  const select = document.getElementById("fileList");
  const fileId = select.value;
  const password = document.getElementById("decryptPassword").value;
  if (!fileId || !password) return alert("Select a file and enter password");

  const token = await getAccessToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const arrayBuffer = await res.arrayBuffer();

  const salt = arrayBuffer.slice(0,16);
  const iv = arrayBuffer.slice(16,28);
  const ciphertext = arrayBuffer.slice(28);
  const key = await deriveKey(password, salt);
  const plaintext = await crypto.subtle.decrypt({ name:"AES-GCM", iv }, key, ciphertext);

  const blob = new Blob([plaintext]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "decrypted";
  a.click();
}

// ===== REFRESH FILE LIST =====
async function refreshFileList() {
  try {
    const data = await callGraph(`/me/drive/root:/${oneDriveFolder}:/children`);
    const select = document.getElementById("fileList");
    select.innerHTML = "";
    data.value.forEach(item => {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = item.name;
      select.appendChild(opt);
    });
  } catch(err) {
    console.error(err);
  }
}

// ===== EVENT LISTENERS =====
document.getElementById("encryptBtn").onclick = encryptAndUpload;
document.getElementById("decryptBtn").onclick = downloadAndDecrypt;
