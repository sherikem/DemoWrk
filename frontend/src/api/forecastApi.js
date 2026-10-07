// frontend/src/api/forecastApi.js
// API client for the Reservations Forecast tab — computed live from
// bookings currently on file (rate_details + reservation_lead_time), no
// workbook upload. See backend/postgres/reservation_forecast.py.

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

async function fetchData(endpoint, options) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
    if (!response.ok) {
        let message = "";
        try {
            const body = await response.json();
            message = body.detail || JSON.stringify(body);
        } catch {
            message = await response.text().catch(() => "");
        }
        throw new Error(message || `Request failed: ${response.status}`);
    }
    return response.json();
}

export const forecastApi = {
    months: () => fetchData("/analytics/forecast/live/months"),
    pickup: () => fetchData("/analytics/forecast/live/pickup"),
    pace: (stayMonth) => fetchData(`/analytics/forecast/live/pace?stay_month=${stayMonth}`),
    projection: (targetMonth, lookbackYears) =>
        fetchData(
            `/analytics/forecast/live/projection?target_month=${targetMonth}` +
                (lookbackYears ? `&lookback_years=${lookbackYears}` : ""),
        ),
};
