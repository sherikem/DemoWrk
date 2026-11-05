"""Idempotent, additive Seasonal Demand schema bootstrap.

Executed during FastAPI startup; no manual migration or destructive ALTER/DROP.
Database role must have CREATE TABLE permission on initial startup.
"""
import logging
from sqlalchemy import text
from .database import engine

log = logging.getLogger(__name__)

SCHEMA_SQL = r'''
CREATE TABLE IF NOT EXISTS seas_demand_stay_nights (
 stay_date DATE NOT NULL, booking_id TEXT NOT NULL,
 villa_name TEXT NOT NULL, bedroom_count INTEGER,
 payment_type TEXT, member_number TEXT,
 booking_revenue NUMERIC(16,2) NOT NULL DEFAULT 0,
 PRIMARY KEY(stay_date,booking_id)
);
CREATE INDEX IF NOT EXISTS seas_stay_villa_date_idx ON seas_demand_stay_nights(villa_name,stay_date);
CREATE INDEX IF NOT EXISTS seas_stay_bedroom_date_idx ON seas_demand_stay_nights(bedroom_count,stay_date);
CREATE TABLE IF NOT EXISTS seas_demand_amenity_events (
 id BIGSERIAL PRIMARY KEY, activity_date DATE NOT NULL,
 amenity TEXT NOT NULL, payment_type TEXT, member_number TEXT,
 charge_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
 free_value NUMERIC(16,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS seas_amenity_date_idx ON seas_demand_amenity_events(activity_date,amenity);
CREATE TABLE IF NOT EXISTS season_calendars (
 id BIGSERIAL PRIMARY KEY,
 calendar_name VARCHAR(150) NOT NULL,
 calendar_year INTEGER NOT NULL CHECK(calendar_year BETWEEN 1900 AND 2200),
 owner_user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS season_calendars_owner_idx ON season_calendars(owner_user_id,calendar_year);
CREATE TABLE IF NOT EXISTS season_periods (
 id BIGSERIAL PRIMARY KEY,
 calendar_id BIGINT NOT NULL REFERENCES season_calendars(id) ON DELETE CASCADE,
 season_name VARCHAR(100) NOT NULL,
 start_date DATE NOT NULL,
 end_date DATE NOT NULL,
 sort_order INTEGER NOT NULL DEFAULT 0,
 CHECK (end_date>=start_date)
);
CREATE INDEX IF NOT EXISTS season_periods_calendar_idx ON season_periods(calendar_id,start_date,end_date);
CREATE TABLE IF NOT EXISTS season_name_presets (
 owner_user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
 name VARCHAR(100) NOT NULL,
 sort_order INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(owner_user_id,name)
);
CREATE TABLE IF NOT EXISTS seas_demand_villa_revenue (
 id BIGSERIAL PRIMARY KEY,
 revenue_date DATE NOT NULL,
 conf_code TEXT NOT NULL,
 villa_name TEXT NOT NULL,
 amount NUMERIC(16,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS seas_villa_rev_date_idx ON seas_demand_villa_revenue(revenue_date, villa_name);
'''


def ensure_seasonal_demand_schema():
    """Create personal season calendar tables once; safe to call repeatedly.

    Fail startup if permissions or schema are invalid rather than silently
    serving a dashboard that will fail on its first request.
    """
    with engine.begin() as connection:
        for statement in SCHEMA_SQL.split(";"):
            if statement.strip():
                connection.execute(text(statement))
    log.info("Seasonal Demand calendar schema is ready")

