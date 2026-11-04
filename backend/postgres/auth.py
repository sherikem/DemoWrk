# backend/postgres/auth.py
"""
Login, current-user and role checks for the DemoWrk dashboard API.

Endpoints (mounted at /auth by main.py):
  POST /auth/login             {username, password} -> {access_token, user}
  GET  /auth/me                the logged-in user + the tab ids they may open
  POST /auth/change-password   {current_password, new_password}
  GET  /auth/users             (admin) list users
  GET  /auth/permissions-meta  (admin) tab list + role presets for the Permissions section
  POST /auth/users             (admin) create user  {username, first_name, last_name, password, role, permissions?}
  PATCH /auth/users/{id}       (admin) change role / name / active / permissions, or reset password
  DELETE /auth/users/{id}      (admin) permanently delete a user

Dependencies used by main.py on every other router:
  get_current_user   401 unless the request has a valid, unexpired token for
                     an active user ("Authorization: Bearer <token>").
  check_access       403 unless the user's role may use the tab that owns the
                     requested path (rules in access_rules.py).

Name and password rules live in form_rules.py (mirrored in the frontend's
formRules.js).

Needs in backend/.env:
  AUTH_SECRET=<long random string>     e.g. python -c "import secrets;print(secrets.token_urlsafe(48))"
  AUTH_TOKEN_HOURS=8                   optional, default 8

Needs: pip install bcrypt PyJWT
Table app_users is created by postgres/create_auth_tables.py.
"""
import json
import logging
import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .access_rules import (
    ALL_TABS, PRESETS, ROLES, SAFE_METHODS, TAB_LABELS,
    effective_permissions, matches_preset, normalize_permissions, tab_for_path,
    user_can_edit, user_can_export, user_can_use,
)
from .analytics_shared import get_db
from .form_rules import clean_name, name_problems, password_problems

load_dotenv()
log = logging.getLogger("auth")

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
AUTH_SECRET = os.getenv("AUTH_SECRET", "")
TOKEN_HOURS = float(os.getenv("AUTH_TOKEN_HOURS", "8"))
ALGORITHM = "HS256"

if len(AUTH_SECRET) < 32:
    raise RuntimeError(
        "AUTH_SECRET is missing or too short in backend/.env. Generate one with: "
        'python -c "import secrets;print(secrets.token_urlsafe(48))"'
    )

router = APIRouter()
bearer = HTTPBearer(auto_error=False)


# ─────────────────────────────────────────────
# PASSWORDS AND TOKENS
# ─────────────────────────────────────────────
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def make_token(user_id: int, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user_id), "role": role, "iat": now,
               "exp": now + timedelta(hours=TOKEN_HOURS)}
    return jwt.encode(payload, AUTH_SECRET, algorithm=ALGORITHM)


def _reject(problems: list):
    """Turn a list of rule problems into one 400 response."""
    if problems:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "; ".join(problems) + ".")


def check_password_rules(password: str, username: str = "", names=()):
    """Raises 400 if the password breaks a rule in form_rules.py.
    `names` is any list of name strings (first name, last name, or a full name)."""
    _reject(password_problems(password, username, names))


def check_names(first_name, last_name):
    """Raises 400 unless both names are present and valid. Returns (first, last)."""
    _reject(name_problems(first_name, "First name") + name_problems(last_name, "Last name"))
    return clean_name(first_name), clean_name(last_name)


# ─────────────────────────────────────────────
# DEPENDENCIES (used by main.py on every router)
# ─────────────────────────────────────────────
def _user_row(db: Session, user_id: int):
    return db.execute(
        text("SELECT id, username, full_name, role, is_active, permissions FROM app_users WHERE id = :id"),
        {"id": user_id},
    ).mappings().first()


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in.",
                            headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(creds.credentials, AUTH_SECRET, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired or invalid. Log in again.",
                            headers={"WWW-Authenticate": "Bearer"})
    user = _user_row(db, user_id)
    if not user or not user["is_active"]:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account is disabled.",
                            headers={"WWW-Authenticate": "Bearer"})
    return dict(user)   # role is read fresh from the DB, so a role change applies immediately


def check_access(request: Request, user: dict = Depends(get_current_user)):
    tab = tab_for_path(request.url.path)
    if tab is None:
        log.warning("unmapped path %s — allowed for any logged-in user", request.url.path)
    if not user_can_use(user, tab):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "You don't have access to this part of the dashboard.")
    if request.method not in SAFE_METHODS and not user_can_edit(user, tab):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "You have view-only access here. You can't make changes.")
    if request.url.path.endswith("/export") and not user_can_export(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't export data.")
    return user


def require_admin(user: dict = Depends(get_current_user)):
    if user["role"] != "Admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admins only.")
    return user


# ─────────────────────────────────────────────
# REQUEST BODIES
# ─────────────────────────────────────────────
class LoginBody(BaseModel):
    username: str
    password: str


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str


class PermissionsBody(BaseModel):
    view_tabs: list[str] = []
    edit_tabs: list[str] = []
    can_export: bool = False


class NewUserBody(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    first_name: str
    last_name: str
    password: str
    role: str
    permissions: PermissionsBody | None = None   # None = follow the role's preset


class UpdateUserBody(BaseModel):
    # first_name and last_name must be sent together (the table stores one full_name).
    first_name: str | None = None
    last_name: str | None = None
    role: str | None = None
    is_active: bool | None = None
    new_password: str | None = None
    # Sent from the Permissions section. Changing the role WITHOUT sending
    # permissions resets the user to the new role's preset.
    permissions: PermissionsBody | None = None


def _public(user) -> dict:
    perms = effective_permissions(user["role"], user.get("permissions"))
    return {"id": user["id"], "username": user["username"], "full_name": user["full_name"],
            "role": user["role"], "tabs": perms["view_tabs"],
            "edit_tabs": perms["edit_tabs"], "can_export": perms["can_export"],
            "custom_permissions": user.get("permissions") is not None}


def _permissions_to_store(role: str, perms: PermissionsBody | None):
    """What goes in app_users.permissions: None (follow the preset) unless the
    admin really changed something. Admin never stores custom permissions."""
    if perms is None or role == "Admin":
        return None
    clean = normalize_permissions(perms.model_dump())
    return None if matches_preset(role, clean) else json.dumps(clean)


# ─────────────────────────────────────────────
# LOGIN / ME / OWN PASSWORD
# ─────────────────────────────────────────────
@router.post("/login")
def login(body: LoginBody, db: Session = Depends(get_db)):
    row = db.execute(
        text("SELECT id, username, full_name, role, is_active, permissions, password_hash "
             "FROM app_users WHERE lower(username) = lower(:u)"),
        {"u": body.username.strip()},
    ).mappings().first()
    # Same message for unknown user and wrong password, so usernames can't be guessed.
    if not row or not row["is_active"] or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong username or password.")
    db.execute(text("UPDATE app_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = :id"),
               {"id": row["id"]})
    db.commit()
    return {"access_token": make_token(row["id"], row["role"]), "token_type": "bearer",
            "user": _public(row)}


@router.get("/me")
def me(user: dict = Depends(get_current_user)):
    return _public(user)


@router.post("/change-password")
def change_password(body: ChangePasswordBody, user: dict = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    current_hash = db.execute(text("SELECT password_hash FROM app_users WHERE id = :id"),
                              {"id": user["id"]}).scalar()
    if not verify_password(body.current_password, current_hash or ""):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is wrong.")
    check_password_rules(body.new_password, user["username"], [user["full_name"] or ""])
    db.execute(text("UPDATE app_users SET password_hash = :h WHERE id = :id"),
               {"h": hash_password(body.new_password), "id": user["id"]})
    db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────
# USER MANAGEMENT (admin only)
# ─────────────────────────────────────────────
@router.get("/permissions-meta")
def permissions_meta(_: dict = Depends(require_admin)):
    """What the Permissions section needs: the tabs, and each role's preset."""
    return {
        "tabs": [{"id": t, "label": TAB_LABELS.get(t, t)} for t in ALL_TABS],
        "presets": {
            role: {"view_tabs": [t for t in p["view_tabs"] if t != "users"],
                   "edit_tabs": [t for t in p["edit_tabs"] if t != "users"],
                   "can_export": p["can_export"]}
            for role, p in PRESETS.items()
        },
        "roles": ROLES,
    }


@router.get("/users")
def list_users(_: dict = Depends(require_admin), db: Session = Depends(get_db)):
    rows = db.execute(text(
        "SELECT id, username, full_name, role, is_active, permissions, created_at, last_login_at "
        "FROM app_users ORDER BY username")).mappings().all()
    out = []
    for r in rows:
        d = dict(r)
        d["custom_permissions"] = d["permissions"] is not None
        d["effective"] = effective_permissions(d["role"], d.pop("permissions"))
        out.append(d)
    return out


@router.post("/users", status_code=201)
def create_user(body: NewUserBody, _: dict = Depends(require_admin), db: Session = Depends(get_db)):
    username = body.username.strip()
    if body.role not in ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Role must be one of: {', '.join(ROLES)}.")
    first, last = check_names(body.first_name, body.last_name)
    check_password_rules(body.password, username, [first, last])
    exists = db.execute(text("SELECT 1 FROM app_users WHERE lower(username) = lower(:u)"),
                        {"u": username}).first()
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "That username is already taken.")
    new_id = db.execute(
        text("INSERT INTO app_users (username, full_name, password_hash, role, permissions) "
             "VALUES (:u, :n, :h, :r, CAST(:p AS JSONB)) RETURNING id"),
        {"u": username, "n": f"{first} {last}", "h": hash_password(body.password),
         "r": body.role, "p": _permissions_to_store(body.role, body.permissions)},
    ).scalar()
    db.commit()
    return {"id": new_id}


@router.patch("/users/{user_id}")
def update_user(user_id: int, body: UpdateUserBody, admin: dict = Depends(require_admin),
                db: Session = Depends(get_db)):
    target = _user_row(db, user_id)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")
    if user_id == admin["id"] and (body.is_active is False or (body.role and body.role != "Admin")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "You can't disable or demote your own admin account.")
    sets, params = [], {"id": user_id}
    full_name = target["full_name"] or ""
    if body.first_name is not None or body.last_name is not None:
        first, last = check_names(body.first_name, body.last_name)
        full_name = f"{first} {last}"
        sets.append("full_name = :n"); params["n"] = full_name
    if body.role is not None:
        if body.role not in ROLES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Role must be one of: {', '.join(ROLES)}.")
        sets.append("role = :r"); params["r"] = body.role
        if body.permissions is None:
            sets.append("permissions = NULL")      # new role -> follow its preset
    if body.permissions is not None:
        final_role = body.role if body.role is not None else target["role"]
        sets.append("permissions = CAST(:p AS JSONB)")
        params["p"] = _permissions_to_store(final_role, body.permissions)
    if body.is_active is not None:
        sets.append("is_active = :a"); params["a"] = body.is_active
    if body.new_password:
        check_password_rules(body.new_password, target["username"], [full_name])
        sets.append("password_hash = :h"); params["h"] = hash_password(body.new_password)
    if sets:
        db.execute(text(f"UPDATE app_users SET {', '.join(sets)} WHERE id = :id"), params)
        db.commit()
    return {"ok": True}


@router.delete("/users/{user_id}")
def delete_user(user_id: int, admin: dict = Depends(require_admin), db: Session = Depends(get_db)):
    if user_id == admin["id"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can't delete your own account.")
    if not _user_row(db, user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")
    try:
        db.execute(text("DELETE FROM app_users WHERE id = :id"), {"id": user_id})
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "This user has linked records and can't be deleted. Disable them instead.")
    return {"ok": True}