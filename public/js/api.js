//shred helper API functions for making requests to the server

async function api(url, method, body) {
  const res = await fetch(url, {
    method: method,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}