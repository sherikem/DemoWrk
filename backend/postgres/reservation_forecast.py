# backend/postgres/reservation_forecast.py
"""
Reservations Forecast tab — nights/revenue on the books by stay month,
computed live from scraped data (rate_details + reservation_lead_time).
No workbook import: an earlier version of this module read the property's
monthly "Summary of Reservations Forecast" Excel export, but that workbook
is being phased out in favor of pulling directly from the portal, so the
parser/upload/snapshot-table machinery has been removed entirely.

WHAT "LIVE" MEANS, AND ITS ONE REAL LIMITATION
  A cancelled reservation is removed from the source system entirely — not
  soft-deleted, not logged anywhere (checked: no cancelled/no-show rows
  exist in rate_details or reservation_lead_time, and there's no history/
  audit table that has them either). So anything computed here can only
  ever reflect reservations that are STILL valid today. That makes every
  number below exactly correct for THIS moment, but it means a past
  snapshot can't be reconstructed after the fact — cancellations that have
  happened since would be invisible. There is no "budget" figure anywhere
  in scraped data; it only ever existed in the old workbook.

rate_details IS nightly-grain — one row per (reservation, rate_date) — and
rate_date IS the calendar night that row belongs to, so nights/revenue by
STAY MONTH are grouped on rate_date, not check_in_date (a stay spanning a
month boundary should split across both months, not dump entirely into its
check-in month). modified_amount is a genuine PER-NIGHT rate (verified: it
changes night to night on a real multi-month reservation) — total_rental is
a reservation-level total repeated on every row and total_amount adds
addon_amount (extras/services) on top, both of which read far higher than
the workbook's own Revenue figures did when checked against a real sample.

REVENUE FILTER: excludes payment_type = 'Free' (comps), not the inverse
"only include 'Paid'" — payment_type is NULL for a large share of 2020-2021
rows specifically (a data-capture gap for that period: journal_scraper.py's
scraped rows depend on a downstream Source -> payment_type classification
step that had nothing to classify for that batch). Requiring payment_type =
'Paid' treated "unknown" as "exclude" and silently dropped most of
2020-2021's real revenue; nights never filtered on payment_type at all, so
this keeps revenue consistent with that.

REVENUE ALSO FILTERS ON status (see _revenue_filter()): Posted-only for
fully completed past months, Unposted-only for the current month onward.
A night's charge only posts at checkout, so every future night AND the
current month's nights (mostly still mid-stay) are 100% Unposted — checked
directly. Requiring Posted everywhere would show $0 for the whole current
month and every future one; requiring nothing would mix in stale
not-yet-billed rows for months that already finished. Nights are never
filtered on status — only revenue is.

reservation_lead_time.created_on (real booking date, unlike rate_details'
scrape-time created_at) is what lets /live/pickup, /live/pace and
/live/projection group by when a booking was actually made; it joins
straight to rate_details on reservation_id (no dedup needed — modified_
amount is per-night, not a reservation-level total, so nothing to double-
count).
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .analytics_shared import get_db, rows

router = APIRouter()

# rate_date grain, with the reservation_status cancellation filter applied
# once here so every route below builds on the same "currently valid" set.
_LIVE_NIGHTS_CTE = """
    WITH live_nights AS (
        SELECT rd.rate_date, rd.modified_amount, rd.payment_type, rd.status, rd.reservation_id
        FROM rate_details rd
        WHERE rd.rate_date IS NOT NULL
          AND COALESCE(LOWER(rd.reservation_status), '') NOT IN ('cancelled', 'canceled', 'no-show')
    )
"""


def _revenue_filter(alias: str = "") -> str:
    # A night's charge only gets posted (billed to the folio) at checkout,
    # so requiring status = 'Posted' everywhere would show $0 for every
    # future month (checked: 100% of future nights are 'Unposted' — there's
    # nothing to bill yet) AND for the current, still-in-progress month
    # (checked: 100% Unposted too — most of its stays haven't checked out
    # yet). So: Posted-only for FULLY COMPLETED past months (strictly
    # before the current month), Unposted-only for the current month
    # onward. Nights are unaffected (still every valid night, matching the
    # source-of-truth occupancy count) — only revenue is filtered this way.
    p = f"{alias}." if alias else ""
    return (
        f"{p}payment_type IS DISTINCT FROM 'Free' AND ("
        f"(DATE_TRUNC('month', {p}rate_date) < DATE_TRUNC('month', CURRENT_DATE) AND {p}status = 'Posted') "
        f"OR (DATE_TRUNC('month', {p}rate_date) >= DATE_TRUNC('month', CURRENT_DATE) AND {p}status = 'Unposted')"
        f")"
    )


@router.get("/forecast/live/months")
def forecast_live_months(db: Session = Depends(get_db)):
    """
    Nights/revenue currently on the books by stay month (year + month),
    across every year present in the data. No budget or same-time-last-
    year columns — see module docstring for why. The frontend derives
    year-over-year and custom period comparisons from this one series
    rather than the backend offering separate range-comparison endpoints.
    """
    return rows(db, _LIVE_NIGHTS_CTE + f"""
        SELECT
            EXTRACT(YEAR FROM rate_date)::int AS year,
            EXTRACT(MONTH FROM rate_date)::int AS month,
            COUNT(*)::float AS nights,
            SUM(modified_amount) FILTER (WHERE {_revenue_filter()})::float AS revenue
        FROM live_nights
        GROUP BY 1, 2
        ORDER BY 1, 2
    """)


@router.get("/forecast/live/pickup")
def forecast_live_pickup(db: Session = Depends(get_db)):
    """
    Nights/revenue booked, grouped by the calendar month the booking was
    MADE (reservation_lead_time.created_on), across every stay month.
    GROSS only, not net: a since-cancelled reservation vanishes from the
    source entirely, so its contribution to the month it was originally
    booked in disappears with it instead of being netted out in the month
    it was cancelled.
    """
    return rows(db, _LIVE_NIGHTS_CTE + f"""
        SELECT
            EXTRACT(YEAR FROM lt.created_on)::int AS year,
            EXTRACT(MONTH FROM lt.created_on)::int AS month,
            COUNT(*)::float AS nights,
            SUM(n.modified_amount) FILTER (WHERE {_revenue_filter("n")})::float AS revenue
        FROM reservation_lead_time lt
        JOIN live_nights n ON n.reservation_id = lt.reservation_id
        WHERE lt.created_on IS NOT NULL
        GROUP BY 1, 2
        ORDER BY 1, 2
    """)


@router.get("/forecast/live/pace")
def forecast_live_pace(stay_month: date = Query(...), db: Session = Depends(get_db)):
    """
    How one stay month's nights/revenue built up by booking date
    (reservation_lead_time.created_on), cumulative. Same gross-not-net
    caveat as /live/pickup — read it as a trend, not a reconciled figure.
    """
    return rows(db, _LIVE_NIGHTS_CTE + f"""
        , monthly AS (
            SELECT
                DATE_TRUNC('month', lt.created_on)::date AS booked_month,
                COUNT(*) AS nights,
                SUM(n.modified_amount) FILTER (WHERE {_revenue_filter("n")}) AS revenue
            FROM reservation_lead_time lt
            JOIN live_nights n ON n.reservation_id = lt.reservation_id
            WHERE lt.created_on IS NOT NULL
              AND DATE_TRUNC('month', n.rate_date)::date = DATE_TRUNC('month', CAST(:stay_month AS DATE))::date
            GROUP BY 1
        )
        SELECT
            booked_month,
            SUM(nights) OVER (ORDER BY booked_month)::float AS nights_cumulative,
            SUM(revenue) OVER (ORDER BY booked_month)::float AS revenue_cumulative
        FROM monthly
        ORDER BY booked_month
    """, {"stay_month": stay_month})


@router.get("/forecast/live/projection")
def forecast_live_projection(
    target_month: date = Query(..., description="Any day in the stay month to project"),
    lookback_years: int = Query(6, ge=1, le=15),
    db: Session = Depends(get_db),
):
    """
    Projects target_month's eventual final nights/revenue from what's
    already on the books, using past years as a guide.

    METHOD: for each of the last `lookback_years` years, look at that same
    calendar month (e.g. every past December for a December target) and
    ask "by the equivalent point in time — the same number of days before
    the month started as today is before target_month — what fraction of
    that month's eventual final total was already on the books?" Averaging
    that fraction across years gives a fill-rate ratio; dividing today's
    actual partial total by that ratio projects the final total. min/max
    ratios across years give a low/high band instead of a single false-
    precision number.

    For a month that's already CURRENT (started but not finished), the
    "equivalent point" is the same number of days INTO the month, not
    before it — days_offset (target_month_start - CURRENT_DATE) is
    negative in that case, and `hist_month_start - days_offset` handles
    both cases with the same formula (see per_year CTE).

    CAVEAT (same root cause as the module docstring): reservation_lead_
    time.created_on coverage isn't complete for every year, so a year's
    ratio is only as trustworthy as its `coverage` (share of that month's
    final nights that have a known booking date at all). Low-coverage
    years are returned, not silently dropped, so the frontend can flag
    them rather than pretend every year is equally reliable.
    """
    year_rows = rows(db, _LIVE_NIGHTS_CTE + f"""
        , params AS (
            SELECT
                DATE_TRUNC('month', CAST(:target_month AS DATE))::date AS target_month_start,
                EXTRACT(MONTH FROM CAST(:target_month AS DATE))::int AS target_month_num,
                (DATE_TRUNC('month', CAST(:target_month AS DATE))::date - CURRENT_DATE)::int AS days_offset
        ),
        years AS (
            SELECT generate_series(
                EXTRACT(YEAR FROM CAST(:target_month AS DATE))::int - :lookback_years,
                EXTRACT(YEAR FROM CAST(:target_month AS DATE))::int - 1
            ) AS yr
        ),
        per_year AS (
            SELECT
                y.yr AS year,
                (make_date(y.yr, p.target_month_num, 1) - p.days_offset) AS cutoff_date,
                COUNT(*)::float AS final_nights,
                SUM(n.modified_amount) FILTER (WHERE {_revenue_filter("n")})::float AS final_revenue,
                COUNT(*) FILTER (
                    WHERE lt.created_on IS NOT NULL
                      AND lt.created_on <= (make_date(y.yr, p.target_month_num, 1) - p.days_offset)
                )::float AS cutoff_nights,
                SUM(n.modified_amount) FILTER (
                    WHERE {_revenue_filter("n")}
                      AND lt.created_on IS NOT NULL
                      AND lt.created_on <= (make_date(y.yr, p.target_month_num, 1) - p.days_offset)
                )::float AS cutoff_revenue,
                COUNT(*) FILTER (WHERE lt.created_on IS NOT NULL)::float AS matched_nights
            FROM years y
            CROSS JOIN params p
            JOIN live_nights n
                ON DATE_TRUNC('month', n.rate_date) = make_date(y.yr, p.target_month_num, 1)
            LEFT JOIN reservation_lead_time lt ON lt.reservation_id = n.reservation_id
            GROUP BY y.yr, p.target_month_num, p.days_offset
        )
        SELECT * FROM per_year WHERE final_revenue > 0 ORDER BY year
    """, {"target_month": target_month, "lookback_years": lookback_years})

    current = rows(db, _LIVE_NIGHTS_CTE + f"""
        SELECT
            COUNT(*)::float AS nights,
            SUM(modified_amount) FILTER (WHERE {_revenue_filter()})::float AS revenue
        FROM live_nights
        WHERE DATE_TRUNC('month', rate_date)::date = DATE_TRUNC('month', CAST(:target_month AS DATE))::date
    """, {"target_month": target_month})
    current_nights = current[0]["nights"] or 0.0
    current_revenue = current[0]["revenue"] or 0.0

    years_out = []
    reliable_night_ratios, reliable_revenue_ratios = [], []
    for r in year_rows:
        coverage = (r["matched_nights"] / r["final_nights"]) if r["final_nights"] else 0.0
        night_ratio = (r["cutoff_nights"] / r["final_nights"]) if r["final_nights"] else None
        revenue_ratio = ((r["cutoff_revenue"] or 0.0) / r["final_revenue"]) if r["final_revenue"] else None
        reliable = coverage >= 0.5
        years_out.append({
            "year": r["year"],
            "final_nights": r["final_nights"],
            "final_revenue": r["final_revenue"],
            "night_ratio": night_ratio,
            "revenue_ratio": revenue_ratio,
            "coverage": coverage,
            "reliable": reliable,
        })
        if reliable and night_ratio and revenue_ratio:
            reliable_night_ratios.append(night_ratio)
            reliable_revenue_ratios.append(revenue_ratio)

    def _band(current_value, ratios):
        if not ratios or current_value <= 0:
            return None
        avg, min_ratio, max_ratio = sum(ratios) / len(ratios), min(ratios), max(ratios)
        # Dividing by a ratio inverts its sense: the LOWEST historical
        # ratio (least was typically booked by this point -> most upside
        # still to come) produces the HIGHEST projected total, and the
        # HIGHEST ratio (most already booked -> least upside left)
        # produces the LOWEST projected total.
        return {
            "ratio_avg": avg,
            "projected_avg": current_value / avg,
            "projected_low": current_value / max_ratio,
            "projected_high": current_value / min_ratio,
        }

    return {
        "target_month": str(date(target_month.year, target_month.month, 1)),
        "current_nights": current_nights,
        "current_revenue": current_revenue,
        "years": years_out,
        "years_used": len(reliable_revenue_ratios),
        "nights_projection": _band(current_nights, reliable_night_ratios),
        "revenue_projection": _band(current_revenue, reliable_revenue_ratios),
    }
