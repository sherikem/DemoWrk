# backend/postgres/access_rules.py
"""
Role-based access rules for the DemoWrk dashboard — the ONE place that says
which role may use which tab, and which API paths belong to which tab.

Used by:
  * postgres/auth.py   check_access() runs on every API request and refuses
                       (403) any path whose tab the user's role doesn't have.
  * GET /auth/me       sends the user's allowed tab ids to the frontend, which
                       hides every other tab (Dashboard.jsx), so the two never
                       drift apart.

To change who sees what, edit ROLE_TABS. To protect a new endpoint, add its
path prefix to PATH_RULES (most specific first). Tab ids match the `id`
values in frontend/src/pages/Dashboard.jsx TABS.
"""

# ─────────────────────────────────────────────
# ROLES → TABS
# ─────────────────────────────────────────────
ALL_TABS = [
    "overview", "demographics", "visits", "finance", "reports", "market",
    "ml", "villa_fees", "guest_revenue", "lead_time", "forecast",
]

# VIEW access: which tabs (and the API paths behind them) a role can open.
# Exports are plain GET requests, so anyone who can view a tab can export it.
ROLE_TABS = {
    "Admin":      ALL_TABS + ["users"],
    "Power-User": ALL_TABS,
    "Read-Only":  ALL_TABS,
    "Finance":    ["finance", "villa_fees", "guest_revenue", "forecast"],
}

# EDIT access: tabs where the role may also make changes (POST/PUT/PATCH/DELETE).
# read_only has none, so it can never change anything.
# A write to an unmapped path (tab None) is allowed for admin only.
ROLE_EDIT_TABS = {
    "Admin":      ALL_TABS + ["users"],
    "Power-User": ALL_TABS,
    "Read-Only":  [],
    "Finance":    ["finance", "villa_fees", "guest_revenue", "forecast"],
}

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

ROLES = list(ROLE_TABS)

# ─────────────────────────────────────────────
# API PATH → TAB
# ─────────────────────────────────────────────
# First matching prefix wins, so keep specific prefixes above general ones.
# A path that matches nothing here falls back to DEFAULT_TAB.
PATH_RULES = [
    ("/auth/users",                          "users"),
    ("/finance",                             "finance"),
    ("/analytics/villa-fees",                "villa_fees"),
    ("/analytics/forecast",                  "forecast"),
    ("/analytics/guest-revenue",             "guest_revenue"),
    ("/analytics/lead-time",                 "lead_time"),
    ("/analytics/ml/marketing-campaigns",    "market"),
    ("/analytics/ml",                        "ml"),
    ("/analytics/season",                    "ml"),         # season-groups, season-summary, seasons/...
    ("/analytics/table",                     "reports"),    # /tables, /table/{name}, /table/{name}/search
    ("/analytics/demographic",               "demographics"),
    ("/analytics/state-accounts",            "demographics"),
    ("/analytics/account-category",          "demographics"),
    ("/analytics/new-vs-repeat-visitors",    "demographics"),
    ("/analytics/villa",                     "visits"),     # villa-bookings, villa-monthly, villa-source-*
    ("/analytics/bedroom-bookings",          "visits"),
    ("/analytics/booked-people",             "visits"),
    ("/analytics/visits-rooms-dashboard",    "visits"),
    ("/analytics/dashboard-summary",         "overview"),
    ("/analytics/visits-tab-summary",        "overview"),
    ("/overview",                            "overview"),
]

# Paths not listed above: any logged-in user may call them. Tighten this to
# a specific tab (or add rules) once every endpoint is mapped; check the
# backend log for "unmapped path" warnings to find the ones still missing.
DEFAULT_TAB = None   # None = any logged-in user


def tab_for_path(path: str):
    """Return the tab id that owns this API path, or DEFAULT_TAB."""
    for prefix, tab in PATH_RULES:
        if path == prefix or path.startswith(prefix):
            return tab
    return DEFAULT_TAB


def role_can_use(role: str, tab) -> bool:
    if tab is None:
        return role in ROLE_TABS
    return tab in ROLE_TABS.get(role, [])


def role_can_edit(role: str, tab) -> bool:
    """May this role make changes (not just view) on this tab?"""
    if tab is None:
        return role == "Admin"
    return tab in ROLE_EDIT_TABS.get(role, [])