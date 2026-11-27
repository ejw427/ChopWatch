const HELPER = "http://127.0.0.1:3781";

async function json(res) {
  if (!res.ok) throw new Error(`Helper ${res.status}`);
  return res.json();
}

export async function fetchSnapshot() {
  return json(await fetch(`${HELPER}/api/snapshot`, { cache: "no-store" }));
}

export async function fetchSettings() {
  return json(await fetch(`${HELPER}/api/settings`, { cache: "no-store" }));
}

export async function saveSettings(body) {
  return json(
    await fetch(`${HELPER}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function clearAuth() {
  return json(
    await fetch(`${HELPER}/api/settings/auth`, { method: "DELETE" }),
  );
}

export async function refreshSaladAccount() {
  return json(
    await fetch(`${HELPER}/api/salad-account?refresh=1`, { cache: "no-store" }),
  );
}

export async function autofillAuth() {
  const res = await fetch(`${HELPER}/api/settings/auth/autofill`, {
    method: "POST",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && !body.ok) {
    throw new Error(body.error || `Helper ${res.status}`);
  }
  return body;
}

export async function startSaladConnect() {
  return json(
    await fetch(`${HELPER}/api/settings/auth/connect`, { method: "POST" }),
  );
}

export async function getSaladConnectStatus() {
  return json(
    await fetch(`${HELPER}/api/settings/auth/connect`, { cache: "no-store" }),
  );
}

export async function cancelSaladConnect() {
  return json(
    await fetch(`${HELPER}/api/settings/auth/connect`, { method: "DELETE" }),
  );
}

export async function setSaladFlags(body) {
  const res = await fetch(`${HELPER}/api/salad/flags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Helper ${res.status}`);
  return data;
}

export async function setSaladPreferences(body) {
  const res = await fetch(`${HELPER}/api/salad/preferences`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Helper ${res.status}`);
  return data;
}

export async function skipSlowDownload(body = {}) {
  const res = await fetch(`${HELPER}/api/download-bail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `Helper ${res.status}`);
  return data;
}
