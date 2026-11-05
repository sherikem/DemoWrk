# backend/postgres/access_rules.py
"""
Role-based access rules for the DemoWrk dashboard — the ONE place that says
which role may use which tab, and which API paths belong to which tab.

HOW PERMISSIONS WORK
  * Each role is a PRESET (see PRESETS): the tabs it can view, the tabs it can
    edit, and whether it can export.
  * A user may also have CUSTOM permissions (app_users.permissions, set from
    the Users tab). If they do, those replace the preset for that user.
    If they don't (NULL), the user simply follows their role's preset.
  * effective_permissions(role, custom) gives the final answer. The server
    uses it on every request, and /auth/me sends it to the frontend.
  * Edit always implies view. Admin always gets the full Admin preset.
  * The "users" tab (user management) is Admin-only and can't be granted.

Used by:
  * postgres/auth.py   check_access() runs on every API request and refuses
                       (403) any path the user may not use.
  * GET /auth/me       sends the user's tab ids to the frontend, which hides
                       every other tab (Dashboard.jsx).

To change what a preset allows, edit PRESETS. To protect a new endpoint, add
its path prefix to PATH_RULES (most specific first). Tab ids match the `id`
values in frontend/src/pages/Dashboard.jsx TABS.
"""

# ─────────────────────────────────────────────
# TABS
# ─────────────────────────────────────────────
ALL_TABS = [
    "overview", "demographics", "visits", "finance", "reports", "market",
    "ml", "villa_fees", "guest_revenue", "lead_time", "forecast",
]

# Names shown in the Permissions section of the Users tab. Edit these to match
# the tab names in Dashboard.jsx if they differ.
TAB_LABELS = {
    "overview":      "Overview",
    "demographics":  "Demographics",
    "visits":        "Visits & Rooms",
    "finance":       "Finance",
    "reports":       "Reports",
    "market":        "Marketing Targeting",
    "ml":            "Seasonal Demand",
    "villa_fees":    "Annual Fees",
    "guest_revenue": "Guest Revenue",
    "lead_time":     "Lead Time",
    "forecast":      "Reservations Forecast",
}

# ─────────────────────────────────────────────
# ROLE PRESETS
# ─────────────────────────────────────────────
# view_tabs  : tabs (and the API paths behind them) the role can open.
# edit_tabs  : tabs where it may also make changes (POST/PUT/PATCH/DELETE).
# can_export : may it download/export data.
# Role names must match the database CHECK constraint, ROLES in
# UsersAdmin.jsx and these keys EXACTLY (spelling, capitals, hyphens).
PRESETS = {
    "Admin": {
        "view_tabs": ALL_TABS + ["users"],
        "edit_tabs": ALL_TABS + ["users"],
        "can_export": True,
    },
    "Power-User": {
        "view_tabs": ["overview", "demographics", "visits"],
        "edit_tabs": ["overview", "demographics", "visits"],
        "can_export": True,
    },
    "Read-Only": {
        "view_tabs": ["overview", "demographics", "visits"],
        "edit_tabs": [],
        "can_export": False,
    },
    "Finance": {
        "view_tabs": ["overview", "finance", "villa_fees", "guest_revenue", "forecast"],
        "edit_tabs": ["overview", "finance", "villa_fees", "guest_revenue", "forecast"],
        "can_export": True,
    },
    "Sales Power-User": {
        "view_tabs": list(ALL_TABS),     # every tab except Users
        "edit_tabs": [],
        "can_export": False,
    },
}

ROLES = list(PRESETS)
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

# Older names, derived from PRESETS so nothing that still imports them breaks.
ROLE_TABS = {r: p["view_tabs"] for r, p in PRESETS.items()}
ROLE_EDIT_TABS = {r: p["edit_tabs"] for r, p in PRESETS.items()}
ROLES_CAN_EXPORT = {r for r, p in PRESETS.items() if p["can_export"]}

# ─────────────────────────────────────────────
# EFFECTIVE PERMISSIONS (preset + optional custom)
# ─────────────────────────────────────────────
def _as_dict(custom):
    """The database may hand back a dict, a JSON string, or None."""
    if custom is None:
        return None
    if isinstance(custom, str):
        import json
        try:
            custom = json.loads(custom)
        except ValueError:
            return None
    return custom if isinstance(custom, dict) else None


def normalize_permissions(raw) -> dict:
    """Clean a permissions dict: known tabs only, no 'users', edit implies view."""
    raw = _as_dict(raw) or {}
    view = [t for t in ALL_TABS if t in (raw.get("view_tabs") or [])]
    edit = [t for t in ALL_TABS if t in (raw.get("edit_tabs") or [])]
    view = [t for t in ALL_TABS if t in set(view) | set(edit)]   # edit implies view
    return {"view_tabs": view, "edit_tabs": edit, "can_export": bool(raw.get("can_export"))}


def effective_permissions(role: str, custom=None) -> dict:
    """The permissions a user really has: custom if set, else the role's preset.
    Admin is always the full Admin preset. Unknown roles get nothing."""
    preset = PRESETS.get(role)
    if preset is None:
        return {"view_tabs": [], "edit_tabs": [], "can_export": False}
    if role == "Admin" or _as_dict(custom) is None:
        return {"view_tabs": list(preset["view_tabs"]),
                "edit_tabs": list(preset["edit_tabs"]),
                "can_export": preset["can_export"]}
    clean = normalize_permissions(custom)
    return clean


def matches_preset(role: str, perms) -> bool:
    """True if these permissions are exactly the role's preset (so there is
    nothing custom to store)."""
    preset = PRESETS.get(role)
    if preset is None:
        return False
    clean = normalize_permissions(perms)
    return (set(clean["view_tabs"]) == set(preset["view_tabs"]) - {"users"}
            and set(clean["edit_tabs"]) == set(preset["edit_tabs"]) - {"users"}
            and clean["can_export"] == preset["can_export"])


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


# ─────────────────────────────────────────────
# CHECKS USED BY auth.py (these take the whole user)
# ─────────────────────────────────────────────
def user_perms(user: dict) -> dict:
    return effective_permissions(user.get("role"), user.get("permissions"))


def user_can_use(user: dict, tab) -> bool:
    if user.get("role") not in PRESETS:
        return False
    if tab is None:
        return True
    return tab in user_perms(user)["view_tabs"]


def user_can_edit(user: dict, tab) -> bool:
    """May this user make changes (not just view) on this tab?
    A write to an unmapped path (tab None) is allowed for Admin only."""
    if tab is None:
        return user.get("role") == "Admin"
    return tab in user_perms(user)["edit_tabs"]


def user_can_export(user: dict) -> bool:
    return user_perms(user)["can_export"]


# Older role-only versions, kept so nothing that still imports them breaks.
def role_can_use(role: str, tab) -> bool:
    return user_can_use({"role": role}, tab)


def role_can_edit(role: str, tab) -> bool:
    return user_can_edit({"role": role}, tab)


def role_can_export(role: str) -> bool:
    return user_can_export({"role": role})
