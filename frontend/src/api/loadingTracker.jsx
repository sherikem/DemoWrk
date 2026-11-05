import { API_BASE_URL } from "./client";

const IGNORE = [
  /\/villa-source-bookings/,
  /\/bedroom-bookings/,
  /\/villa-monthly/,
  /\/booked-people/,
  /\/finance\/drilldown/,
  /\/finance\/villa-reservations/,
  /\/seasons\/\d+\/members/,
  /\/state-accounts\//,
  /\/account-category\//,
  /\/demographics\/account-details/,
  /\/new-vs-repeat-visitors\/details/,
  /\/marketing-campaigns\/[^/?]+\/members/,
  /seasonal_only=true/,
  /\/auth\//,
];

let active = 0;
let installed = false;

const listeners = new Set();

function emit() {
  listeners.forEach((fn) => fn(active));
}

export function subscribeLoading(fn) {
  listeners.add(fn);
  fn(active);

  return () => listeners.delete(fn);
}

export function installLoadingTracker() {
  if (installed) return;
  installed = true;

  const originalFetch = window.fetch.bind(window);
  const baseUrl = new URL(API_BASE_URL, window.location.href);

  window.fetch = (input, init) => {
    const rawUrl =
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input?.url;

    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();

    const requestUrl = new URL(rawUrl, window.location.href);

    const basePath = baseUrl.pathname.replace(/\/$/, "");

    const isApi =
      requestUrl.origin === baseUrl.origin &&
      (requestUrl.pathname === basePath ||
        requestUrl.pathname.startsWith(basePath + "/"));

    const tracked =
      isApi &&
      method === "GET" &&
      !IGNORE.some((pattern) => pattern.test(requestUrl.href));

    if (!tracked) {
      return originalFetch(input, init);
    }

    // Start tracking
    const start = performance.now();

    active += 1;
    emit();

    console.log(
      "[Loading started]",
      requestUrl.pathname,
      "Active requests:",
      active,
    );

    let request;

    try {
      request = originalFetch(input, init);
    } catch (error) {
      active = Math.max(0, active - 1);
      emit();
      throw error;
    }

    return Promise.resolve(request).finally(() => {
      const duration = Math.round(performance.now() - start);

      active = Math.max(0, active - 1);
      emit();

      console.log(
        "[Loading finished]",
        requestUrl.pathname,
        `${duration}ms`,
        "Remaining requests:",
        active,
      );
    });
  };
}
