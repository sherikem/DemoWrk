import { authFetch } from "./client";
const BASE = `${(import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "")}/analytics/seasonal-demand`;
async function call(path, method = "GET", body) {
  const res = await authFetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(
      typeof data?.detail === "string"
        ? data.detail
        : `Request failed (${res.status})`,
    );
  }
  return res.json();
}
const params = (o) => {
  const q = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") q.set(k, v);
  });
  return `?${q}`;
};
export const seasonalDemandApi = {
  config: () => call("/config"),
  availableYears: () => call("/available-years"),
  status: () => call("/status"),
  calendars: () => call("/calendars"),
  createCalendar: (v) => call("/calendars", "POST", v),
  saveCalendar: (id, v) => call(`/calendars/${id}`, "PUT", v),
  deleteCalendar: (id) => call(`/calendars/${id}`, "DELETE"),
  preview: (v) => call("/calendars/preview", "POST", v),
  saveNames: (names) => call("/names", "PUT", { names }),
  resetNames: () => call("/names/reset", "POST"),
  months: (filter = {}) => call(`/months${params(filter)}`),
  seasons: (calendar_id, filter = {}) =>
    call(`/seasons${params({ calendar_id, ...filter })}`),
};
