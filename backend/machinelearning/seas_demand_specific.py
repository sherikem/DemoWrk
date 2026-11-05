"""Seasonal Demand fact builder. Reuses Overview's one-row-per-booking view.

Does not create seasons. All grouping happens at query time, using real dates.
Run after the Overview materialized views refresh:
    python machinelearning/seas_demand_specific.py [--dry-run]
"""
from __future__ import annotations
import argparse
import logging
import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# Existing Overview booking view is unique on overview_conf_code and excludes
# cancelled/no-show/incomplete stays. Each generated row is one ACTUAL stay night.
STAY_SQL = """
INSERT INTO seas_demand_stay_nights
(stay_date, booking_id, villa_name, bedroom_count, payment_type, member_number, booking_revenue)
SELECT night::date, b.overview_conf_code::text,
       b.overview_villa_name, b.overview_bedroom_count::int,
       CASE WHEN COALESCE(b.overview_payment_type,'') ~* '(comp|free|complimentary|gratis|no charge)'
            THEN 'Free' ELSE 'Paid' END, b.overview_member_number::text,
       CASE WHEN night::date = b.overview_check_in_date::date
            THEN COALESCE(b.overview_villa_revenue, 0) ELSE 0 END
FROM overview_villa_bookings b
CROSS JOIN LATERAL generate_series(
    b.overview_check_in_date::date,
    b.overview_check_out_date::date - 1,
    interval '1 day'
) AS night
WHERE b.overview_check_out_date > b.overview_check_in_date
  AND UPPER(REPLACE(TRIM(b.overview_villa_name), ' ', '')) <> 'ZZCOMP'
"""

# Amenity activity uses transaction_date, NOT booking check-in. Folios may have
# multiple charges for one visit; each posted charge is one recorded activity line.
# Excludes reversal/payment/credit rows as usage; supporting revenue is a gross
# charge estimate and must not be presented as Finance-reconciled net revenue.
AMENITY_SQL = r"""
INSERT INTO seas_demand_amenity_events
(activity_date, amenity, payment_type, member_number, charge_amount, free_value)
SELECT f.transaction_date::date,
       CASE
         WHEN f.transaction_category = 'F&B' THEN
           CASE WHEN f.description ~* '\mgrill\M' THEN 'Grill'
                WHEN f.description ~* '\mbar\M' THEN 'Bar'
                WHEN f.description ~* '\m(restaurant|dinner|lunch|breakfast)\M' THEN 'Restaurant'
                ELSE 'F&B' END
         WHEN f.transaction_category = 'Spa & Beauty' THEN 'Spa'
         ELSE f.transaction_category END,
       CASE WHEN COALESCE(f.payment_type,'') ~* '(comp|free|complimentary|gratis|no charge)'
            THEN 'Free' ELSE 'Paid' END,
       f.member_number::text,
       CASE WHEN COALESCE(f.payment_type,'') ~* '(comp|free|complimentary|gratis|no charge)'
            THEN 0 ELSE GREATEST(COALESCE(f.amount,0),0) END,
       CASE WHEN COALESCE(f.payment_type,'') ~* '(comp|free|complimentary|gratis|no charge)'
            THEN GREATEST(COALESCE(f.amount,0),0) ELSE 0 END
FROM folios_unified_display f
WHERE f.transaction_date IS NOT NULL
  AND f.line_status = 'Posted'
  AND f.transaction_flow = 'Charge'
  AND COALESCE(f.folio_source,'') NOT IN ('synthetic_statement','synthetic_villa_income')
  AND f.check_out_date < CURRENT_DATE
  AND COALESCE(LOWER(f.reservation_status), '') NOT IN ('cancelled','canceled','no-show')
  AND f.transaction_category IN (
      'Golf','Commissary','Spa & Beauty','Tennis','Boutique','Water Sports',
      'Equipment','Cart Rental','Events','F&B'
  )
"""

DDL = """
CREATE TABLE IF NOT EXISTS seas_demand_stay_nights (
    stay_date DATE NOT NULL, booking_id TEXT NOT NULL,
    villa_name TEXT NOT NULL, bedroom_count INTEGER,
    payment_type TEXT, member_number TEXT, booking_revenue NUMERIC(16,2) NOT NULL DEFAULT 0,
    PRIMARY KEY (stay_date, booking_id)
);
CREATE INDEX IF NOT EXISTS seas_stay_villa_date_idx ON seas_demand_stay_nights(villa_name, stay_date);
CREATE INDEX IF NOT EXISTS seas_stay_bedroom_date_idx ON seas_demand_stay_nights(bedroom_count, stay_date);
CREATE TABLE IF NOT EXISTS seas_demand_amenity_events (
    id BIGSERIAL PRIMARY KEY, activity_date DATE NOT NULL, amenity TEXT NOT NULL,
    payment_type TEXT, member_number TEXT,
    charge_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
    free_value NUMERIC(16,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS seas_amenity_date_idx ON seas_demand_amenity_events(activity_date, amenity);
CREATE TABLE IF NOT EXISTS seas_demand_villa_revenue (
 id BIGSERIAL PRIMARY KEY,
 revenue_date DATE NOT NULL,
 conf_code TEXT NOT NULL,
 villa_name TEXT NOT NULL,
 amount NUMERIC(16,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS seas_villa_rev_date_idx ON seas_demand_villa_revenue(revenue_date, villa_name);
"""

REVENUE_SQL = """
INSERT INTO seas_demand_villa_revenue (revenue_date, conf_code, villa_name, amount)
SELECT revenue_date, conf_code, villa_name, amount
FROM (
    SELECT obm.overview_check_in_date::date AS revenue_date,
           otl.overview_conf_code::text AS conf_code,
           COALESCE(NULLIF(TRIM(otl.overview_villa_name), ''),
                    NULLIF(TRIM(obm.overview_villa_name), '')) AS villa_name,
           ROUND(SUM(otl.overview_net_amount)::numeric, 2) AS amount
    FROM overview_transaction_lines otl
    JOIN overview_booking_meta obm
      ON obm.overview_conf_code::text = otl.overview_conf_code::text
    WHERE otl.overview_line_category = 'Villa'
      AND otl.overview_line_status = 'Paid'
      AND otl.overview_conf_code::text ~ '^[0-9]+$'
      AND otl.overview_conf_code::text::bigint >= 9000000
      AND LOWER(TRIM(COALESCE(obm.overview_payment_type, ''))) = 'paid'
      AND obm.overview_check_in_date IS NOT NULL
    GROUP BY 1, 2, 3
) x
WHERE villa_name IS NOT NULL AND LOWER(villa_name) <> 'zz comp'
"""

def build_seasonal_demand_tables(dry_run=False):
    url = URL.create('postgresql+psycopg2', username=os.environ['DB_USER'],
        password=os.environ['DB_PASSWORD'], host=os.environ['DB_HOST'],
        port=int(os.environ['DB_PORT']), database=os.environ['DB_NAME'])
    engine = create_engine(url)
    with engine.begin() as conn:
        for statement in DDL.split(';'):
            if statement.strip(): conn.execute(text(statement))
        # Refresh atomically: readers never observe a partially populated table.
        conn.execute(text('TRUNCATE seas_demand_stay_nights, seas_demand_amenity_events RESTART IDENTITY'))
        conn.execute(text(STAY_SQL))
        conn.execute(text(AMENITY_SQL))
        conn.execute(text(REVENUE_SQL))
        nights = conn.execute(text('SELECT COUNT(*) FROM seas_demand_stay_nights')).scalar()
        events = conn.execute(text('SELECT COUNT(*) FROM seas_demand_amenity_events')).scalar()
        log.info('Built %s booking-nights and %s amenity charge lines', nights, events)
        if dry_run:
            conn.rollback()
    engine.dispose()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    build_seasonal_demand_tables(parser.parse_args().dry_run)
