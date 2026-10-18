from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from postgres.analytics import router as analytics_router
from postgres.finance_backend import router as finance_router
from postgres.overview_analytics import router as overview_router
from postgres.analytics_guest_revenue import router as guest_revenue_router
from postgres.analytics_villa_fees import router as villa_fees_router
from postgres.reservation_forecast import router as reservation_forecast_router
from postgres.auth import check_access, router as auth_router

app = FastAPI()

# ─────────────────────────────────────────────
# CORS — internal network only
# ─────────────────────────────────────────────
# Allows this machine and any private network address (10.x, 172.16-31.x,
# 192.168.x) on any port, so the server's IP can change without editing this.
# If the Netlify site must still reach this API, add:
#   allow_origins=["https://interntproductsite.netlify.app"],
INTERNAL_ORIGIN_REGEX = (
    r"^http://("
    r"localhost|127\.0\.0\.1"
    r"|10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
    r"|192\.168\.\d{1,3}\.\d{1,3}"
    r"|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}"
    r")(:\d+)?$"
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=INTERNAL_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────
# PUBLIC ROUTES
# ─────────────────────────────────────────────
@app.get("/")
def root():
    return {"message": "FastAPI backend is running"}


# /auth/login is public; /auth/me, /auth/change-password and /auth/users
# check the login (and admin role) themselves.
app.include_router(auth_router, prefix="/auth", tags=["Auth"])

# ─────────────────────────────────────────────
# PROTECTED DATA ROUTES (login + role per tab)
# ─────────────────────────────────────────────
# Step 4 of the rollout: set PROTECTED = [] until the login UI works.
PROTECTED = [Depends(check_access)]

app.include_router(analytics_router, prefix="/analytics", tags=["Analytics"], dependencies=PROTECTED)
app.include_router(finance_router, prefix="/finance", tags=["Finance"], dependencies=PROTECTED)
app.include_router(overview_router, prefix="/overview", tags=["Overview"], dependencies=PROTECTED)
app.include_router(villa_fees_router, prefix="/analytics", tags=["Villa Fees"], dependencies=PROTECTED)
app.include_router(guest_revenue_router, prefix="/analytics", tags=["Guest Revenue"], dependencies=PROTECTED)
app.include_router(reservation_forecast_router, prefix="/analytics", tags=["Reservations Forecast"], dependencies=PROTECTED)