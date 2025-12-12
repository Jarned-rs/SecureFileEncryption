//--------------------------------------------------------------------------
// IMPORT MSAL.JS
//--------------------------------------------------------------------------

import { PublicClientApplication } 
    from "https://alcdn.msauth.net/browser/2.38.0/js/msal-browser.esm.min.js";


//--------------------------------------------------------------------------
// 1. MICROSOFT APP CONFIGURATION
//--------------------------------------------------------------------------

const msalConfig = {
    auth: {
        clientId: "10205ada-7ccc-48b1-8919-0ad38685e6e5",
        redirectUri: "https://jarned-rs.github.io/SecureFileEncryption/"
    }
};

const msalInstance = new PublicClientApplication(msalConfig);
let accessToken = null;


//--------------------------------------------------------------------------
// 2. LOGIN & LOGOUT
//--------------------------------------------------------------------------

async function login() {
    try {
        const result = await msalInstance.loginPopup({
            scopes: ["Files.ReadWrite"]
        });

        accessToken = result.accessToken;

        document.getElementById("signin").classList.add("hidden");
        document.getElementById("signout").classList.remove("hidden");
        document.getElementById("app").classList.remove("hidden");

        loadFiles();
    } catch (err) {
        alert("Login failed: " + err.message);
    }
}

async function logout() {
    await msalInstance.logoutPopup();
    location.reload();
}

document.getElementById("signin").onclick = login;
document.getElementById("signout").onclick = logout;


//--------------------------------------------------------------------------
// 3. CRYPTOGRAPHY — AES-GCM ENCRYPTION
//--------------------------------------------------------------------------

async function deriveKey(password) {
    const enc = new TextEncoder();

    // Convert password → PBKDF2 key
    const baseKey = await crypto.subtle.importKey(
        "raw",
        enc.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );

    // Derive AES-GCM key
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

    // Combine IV + encrypted data
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


//--------------------------------------------------------------------------
// 4. ONEDRIVE API — UPLOAD, LIST, DOWNLOAD
//--------------------------------------------------------------------------

async function uploadEncryptedFile() {
    const file = document.getElementById("fileInput").files[0];
    const password = document.getElementById("password").value;

    if (!file) {
        alert("Choose a file first.");
        return;
    }
    if (!password) {
        alert("Enter a password first.");
        return;
    }

    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const encryptedBytes = await encryptFile(password, fileBytes);

    const uploadUrl =
        "https://graph.microsoft.com/v1.0/me/drive/root:/SecureEncryptedFiles/" +
        encodeURIComponent(file.name + ".enc") +
        ":/content";

    await fetch(uploadUrl, {
        method: "PUT",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/octet-stream"
        },
        body: encryptedBytes
    });

    alert("Encrypted file uploaded.");
    loadFiles();
}

document.getElementById("uploadBtn").onclick = uploadEncryptedFile;


//--------------------------------------------------------------------------
// LOAD FILE LIST
//--------------------------------------------------------------------------

async function loadFiles() {
    const listUrl =
        "https://graph.microsoft.com/v1.0/me/drive/root:/SecureEncryptedFiles:/children";

    const res = await fetch(listUrl, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    const data = await res.json();
    const fileList = document.getElementById("fileList");
    fileList.innerHTML = "";

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


//--------------------------------------------------------------------------
// DOWNLOAD + DECRYPT
//--------------------------------------------------------------------------

async function downloadAndDecrypt(filename) {
    const password = document.getElementById("password").value;

    if (!password) {
        alert("Enter your password first.");
        return;
    }

    const downloadUrl =
        "https://graph.microsoft.com/v1.0/me/drive/root:/SecureEncryptedFiles/" +
        encodeURIComponent(filename) +
        ":/content";

    const res = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    const encryptedBytes = new Uint8Array(await res.arrayBuffer());

    try {
        const decrypted = await decryptFile(password, encryptedBytes);

        // Create download link
        const blob = new Blob([decrypted]);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename.replace(".enc", "");
        a.click();
    } catch (err) {
        alert("Incorrect password or corrupted file.");
    }
}


