"""Authenticated Seasonal Demand: private calendars and date-accurate demand."""
from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session
from .analytics_shared import get_db, rows
from .auth import get_current_user
from .seasonal_demand_schema import ensure_seasonal_demand_schema

router = APIRouter(prefix='/seasonal-demand')
DEFAULT_NAMES = ['High Season', 'Shoulder Season', 'Low Season', 'Summer',
                 'Spring Break', 'Presidents Week', 'Easter', 'Thanksgiving',
                 'Christmas / New Year']

class PeriodIn(BaseModel):
    season_name: str = Field(min_length=1, max_length=100)
    start_date: date
    end_date: date

class CalendarIn(BaseModel):
    calendar_name: str = Field(min_length=1, max_length=150)
    calendar_year: int = Field(ge=1900, le=2200)
    periods: list[PeriodIn] = Field(default_factory=list, max_length=100)

class NamesIn(BaseModel):
    names: list[str] = Field(max_length=100)


def _validate(payload: CalendarIn):
    intervals = sorted(payload.periods, key=lambda p: p.start_date)
    if any(p.start_date.year != payload.calendar_year for p in intervals):
        raise HTTPException(422, 'Each season must start in its calendar year; it may end the next year')
    for p in intervals:
        if not p.season_name.strip() or p.end_date < p.start_date:
            raise HTTPException(422, 'Season names and date ranges must be valid')
    for left, right in zip(intervals, intervals[1:]):
        if left.end_date >= right.start_date:
            raise HTTPException(422, 'Seasons in the same calendar cannot overlap')


def _owned(db, calendar_id, user_id):
    record = db.execute(text('''
        SELECT id, calendar_name, calendar_year FROM season_calendars
        WHERE id=:id AND owner_user_id=:owner
    '''), {'id': calendar_id, 'owner': user_id}).mappings().first()
    if not record:
        raise HTTPException(404, 'Calendar not found')
    return dict(record)


def _calendar(db, item):
    item = dict(item)
    item['periods'] = rows(db, '''
        SELECT id, season_name, start_date, end_date, sort_order
        FROM season_periods WHERE calendar_id=:id ORDER BY sort_order,id
    ''', {'id': item['id']})
    return item

@router.get('/config')
def config(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    ensure_seasonal_demand_schema()
    uid = user['id']
    saved = rows(db, 'SELECT name FROM season_name_presets WHERE owner_user_id=:id ORDER BY sort_order', {'id':uid})
    calendars = rows(db, '''SELECT id,calendar_name,calendar_year,updated_at
        FROM season_calendars WHERE owner_user_id=:id
        ORDER BY calendar_year DESC, updated_at DESC''', {'id':uid})
    return {'names': [r['name'] for r in saved] if saved else DEFAULT_NAMES,
            'defaultNames': DEFAULT_NAMES, 'calendars': calendars}

@router.put('/names')
def save_names(payload: NamesIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    ensure_seasonal_demand_schema()
    names = list(dict.fromkeys(n.strip() for n in payload.names if n.strip()))
    if len(names) != len(payload.names):
        raise HTTPException(422, 'Names must be nonempty and unique')
    db.execute(text('DELETE FROM season_name_presets WHERE owner_user_id=:id'), {'id':user['id']})
    for index, name in enumerate(names):
        if len(name)>100: raise HTTPException(422, 'Name is too long')
        db.execute(text('INSERT INTO season_name_presets(owner_user_id,name,sort_order) VALUES(:u,:n,:s)'),
                   {'u':user['id'],'n':name,'s':index})
    db.commit()
    return {'names':names}

@router.post('/names/reset')
def reset_names(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    ensure_seasonal_demand_schema()
    db.execute(text('DELETE FROM season_name_presets WHERE owner_user_id=:id'), {'id':user['id']})
    db.commit()
    return {'names': DEFAULT_NAMES}

@router.get('/calendars')
def list_calendars(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    ensure_seasonal_demand_schema()
    return [_calendar(db, x) for x in rows(db, '''SELECT id,calendar_name,calendar_year
        FROM season_calendars WHERE owner_user_id=:id ORDER BY calendar_year DESC,id DESC''', {'id':user['id']})]

@router.post('/calendars', status_code=201)
def create_calendar(payload: CalendarIn, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    ensure_seasonal_demand_schema()
    _validate(payload)
    _validate_preset_names(db, user['id'], payload.periods)
    item = db.execute(text('''INSERT INTO season_calendars(calendar_name,calendar_year,owner_user_id)
        VALUES(:name,:year,:owner) RETURNING id,calendar_name,calendar_year'''),
        {'name':payload.calendar_name.strip(),'year':payload.calendar_year,'owner':user['id']}).mappings().one()
    _save_periods(db,item['id'],payload.periods)
    db.commit()
    return _calendar(db,item)


def _validate_preset_names(db, owner_id, periods):
    configured = rows(db, 'SELECT name FROM season_name_presets WHERE owner_user_id=:id', {'id': owner_id})
    valid = {r['name'] for r in configured} if configured else set(DEFAULT_NAMES)
    unknown = sorted({p.season_name.strip() for p in periods} - valid)
    if unknown:
        raise HTTPException(422, 'Save season names in your template first: ' + ', '.join(unknown))


def _save_periods(db,calendar_id,periods):
    db.execute(text('DELETE FROM season_periods WHERE calendar_id=:id'), {'id':calendar_id})
    for order,p in enumerate(periods):
        db.execute(text('''INSERT INTO season_periods(calendar_id,season_name,start_date,end_date,sort_order)
            VALUES(:id,:name,:start,:end,:order)'''),
            {'id':calendar_id,'name':p.season_name.strip(),'start':p.start_date,
             'end':p.end_date,'order':order})

@router.put('/calendars/{calendar_id}')
def update_calendar(calendar_id:int,payload:CalendarIn,db:Session=Depends(get_db),user:dict=Depends(get_current_user)):
    ensure_seasonal_demand_schema()
    _owned(db,calendar_id,user['id'])
    _validate(payload)
    _validate_preset_names(db, user['id'], payload.periods)
    db.execute(text('''UPDATE season_calendars SET calendar_name=:name,calendar_year=:year,
        updated_at=NOW() WHERE id=:id'''),
        {'name':payload.calendar_name.strip(),'year':payload.calendar_year,'id':calendar_id})
    _save_periods(db,calendar_id,payload.periods)
    db.commit()
    return _calendar(db,_owned(db,calendar_id,user['id']))

@router.delete('/calendars/{calendar_id}')
def delete_calendar(calendar_id:int,db:Session=Depends(get_db),user:dict=Depends(get_current_user)):
    ensure_seasonal_demand_schema()
    _owned(db,calendar_id,user['id'])
    db.execute(text('DELETE FROM season_calendars WHERE id=:id'),{'id':calendar_id})
    db.commit()
    return {'ok':True}

@router.post('/calendars/preview')
def preview(payload:CalendarIn,db:Session=Depends(get_db),user:dict=Depends(get_current_user)):
    ensure_seasonal_demand_schema()
    _validate(payload)
    return {'valid':True,'periods':len(payload.periods),'days':sum((p.end_date-p.start_date).days+1 for p in payload.periods)}


def _dates(start_date,end_date):
    if start_date and end_date and start_date>end_date:
        raise HTTPException(422,'Start date must be before end date')
    return {'start':start_date or date(1900,1,1),'end':end_date or date(2200,12,31)}


def _facts(db,period_sql,params):
    stay = rows(db, f'''SELECT p.period_id, p.period_name, p.period_year, p.period_month,
           s.villa_name, s.bedroom_count, s.payment_type,
           COUNT(*)::int AS nights, COUNT(DISTINCT s.booking_id)::int AS bookings,
           COUNT(DISTINCT s.member_number)::int AS unique_members,
           COUNT(DISTINCT s.villa_name)::int AS villa_count,
           ROUND(SUM(s.booking_revenue),2) AS revenue
        FROM seas_demand_stay_nights s
        JOIN ({period_sql}) p ON s.stay_date BETWEEN p.start_date AND p.end_date
        GROUP BY p.period_id,p.period_name,p.period_year,p.period_month,
                 s.villa_name,s.bedroom_count,s.payment_type
        ORDER BY p.period_year,p.period_month,p.period_id,s.villa_name''',params)
    amenity = rows(db,f'''SELECT p.period_id,p.period_name,p.period_year,p.period_month,
           a.amenity,a.payment_type,COUNT(*)::int AS usage_count,
           COUNT(DISTINCT a.member_number)::int AS unique_members,
           ROUND(SUM(a.charge_amount),2) AS revenue,
           ROUND(SUM(a.free_value),2) AS free_value
        FROM seas_demand_amenity_events a
        JOIN ({period_sql}) p ON a.activity_date BETWEEN p.start_date AND p.end_date
        GROUP BY p.period_id,p.period_name,p.period_year,p.period_month,a.amenity,a.payment_type
        ORDER BY p.period_year,p.period_month,p.period_id,a.amenity''',params)
    summary = rows(db, f'''SELECT p.period_id,p.period_name,p.period_year,p.period_month,
           COUNT(*)::int AS booked_nights,
           COUNT(DISTINCT s.booking_id)::int AS distinct_bookings,
           COUNT(DISTINCT s.member_number)::int AS unique_members,
           ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT s.booking_id),0),2) AS observed_nights_per_booking
        FROM seas_demand_stay_nights s
        JOIN ({period_sql}) p ON s.stay_date BETWEEN p.start_date AND p.end_date
        GROUP BY p.period_id,p.period_name,p.period_year,p.period_month
        ORDER BY p.period_year,p.period_month,p.period_id''', params)
    revenue = rows(db, f'''SELECT p.period_id, p.period_year, p.period_month, r.villa_name,
           ROUND(SUM(r.amount),2) AS revenue,
           COUNT(DISTINCT r.conf_code)::int AS revenue_bookings
        FROM seas_demand_villa_revenue r
        JOIN ({period_sql}) p ON r.revenue_date BETWEEN p.start_date AND p.end_date
        GROUP BY p.period_id,p.period_year,p.period_month,r.villa_name
        ORDER BY p.period_year,p.period_month,r.villa_name''', params)
    return {'stay':stay,'amenity':amenity,'summary':summary,'revenue':revenue}

@router.get('/months')
def months(start_date:date|None=None,end_date:date|None=None,
           db:Session=Depends(get_db),user:dict=Depends(get_current_user)):
    ensure_seasonal_demand_schema()
    params=_dates(start_date,end_date)
    # Generate months across the requested range, but cap to years with facts
    # if no range was selected. Clipping ensures partial months are exact.
    bounds=rows(db,'''SELECT MIN(d) AS first,MAX(d) AS last FROM (
        SELECT MIN(stay_date) d FROM seas_demand_stay_nights
        UNION ALL SELECT MAX(stay_date) FROM seas_demand_stay_nights
        UNION ALL SELECT MIN(activity_date) FROM seas_demand_amenity_events
        UNION ALL SELECT MAX(activity_date) FROM seas_demand_amenity_events
    ) dates''')[0]
    if not bounds['first'] or not bounds['last']:
        return {'stay':[],'amenity':[],'summary':[]}
    params['start']=max(params['start'],bounds['first'])
    params['end']=min(params['end'],bounds['last'])
    if params['start']>params['end']: return {'stay':[],'amenity':[],'summary':[]}
    period_sql='''SELECT TO_CHAR(m,'YYYY-MM') AS period_id,
        TO_CHAR(m,'Mon YYYY') AS period_name,
        EXTRACT(YEAR FROM m)::int AS period_year,
        EXTRACT(MONTH FROM m)::int AS period_month,
        GREATEST(m::date,:start) AS start_date,
        LEAST((m + INTERVAL '1 month - 1 day')::date,:end) AS end_date
        FROM generate_series(date_trunc('month',CAST(:start AS timestamp)),
        date_trunc('month',CAST(:end AS timestamp)),INTERVAL '1 month') m'''
    result=_facts(db,period_sql,params)
    for kind in ('stay','amenity'):
        for row in result[kind]:
            row['year']=row['period_year'];row['month']=row['period_month']
    return result

@router.get('/seasons')
def seasons(calendar_id:int=Query(...),start_date:date|None=None,end_date:date|None=None,
            db:Session=Depends(get_db),user:dict=Depends(get_current_user)):
    ensure_seasonal_demand_schema()
    _owned(db,calendar_id,user['id'])
    params=_dates(start_date,end_date);params['calendar_id']=calendar_id
    period_sql='''SELECT sp.id::text AS period_id,sp.season_name AS period_name,
        EXTRACT(YEAR FROM sp.start_date)::int AS period_year,
        EXTRACT(MONTH FROM sp.start_date)::int AS period_month,
        GREATEST(sp.start_date,:start) AS start_date,
        LEAST(sp.end_date,:end) AS end_date
        FROM season_periods sp WHERE sp.calendar_id=:calendar_id
        AND sp.start_date<=:end AND sp.end_date>=:start'''
    result=_facts(db,period_sql,params)
    for kind in ('stay','amenity'):
        for row in result[kind]:row['season_id']=int(row['period_id'])
    return result



@router.get('/available-years')
def available_years(db:Session=Depends(get_db),user:dict=Depends(get_current_user)):
    ensure_seasonal_demand_schema()
    """Only years with actual recorded stay nights or amenity transactions."""
    found = rows(db, """SELECT DISTINCT EXTRACT(YEAR FROM day)::int AS year FROM (
      SELECT stay_date AS day FROM seas_demand_stay_nights
      UNION ALL SELECT activity_date AS day FROM seas_demand_amenity_events
    ) d ORDER BY year DESC""")
    return {'years': [r['year'] for r in found]}


@router.get('/status')
def demand_status(db:Session=Depends(get_db),user:dict=Depends(get_current_user)):
    ensure_seasonal_demand_schema()
    """Surface empty facts instead of presenting zero demand as a valid historical result."""
    return rows(db, """SELECT
      (SELECT COUNT(*) FROM seas_demand_stay_nights)::int AS booked_night_rows,
      (SELECT COUNT(*) FROM seas_demand_amenity_events)::int AS amenity_transaction_rows,
      (SELECT MAX(stay_date) FROM seas_demand_stay_nights) AS latest_stay_date,
      (SELECT MAX(activity_date) FROM seas_demand_amenity_events) AS latest_amenity_date""")[0]
