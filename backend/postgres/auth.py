# backend/postgres/auth.py
"""
Login, current-user and role checks for the DemoWrk dashboard API.

Endpoints (mounted at /auth by main.py):
  POST /auth/login             {username, password} -> {access_token, user}
  GET  /auth/me                the logged-in user + the tab ids they may open
  POST /auth/change-password   {current_password, new_password}
  GET  /auth/users             (admin) list users
  POST /auth/users             (admin) create user
  PATCH /auth/users/{id}       (admin) change role / name / active, or reset password

Dependencies used by main.py on every other router:
  get_current_user   401 unless the request has a valid, unexpired token for
                     an active user ("Authorization: Bearer <token>").
  check_access       403 unless the user's role may use the tab that owns the
                     requested path (rules in access_rules.py).

Needs in backend/.env:
  AUTH_SECRET=<long random string>     e.g. python -c "import secrets;print(secrets.token_urlsafe(48))"
  AUTH_TOKEN_HOURS=8                   optional, default 8

Needs: pip install bcrypt PyJWT
Table app_users is created by postgres/create_auth_tables.py.
"""
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
from sqlalchemy.orm import Session

from .access_rules import ROLE_TABS, ROLES, role_can_use, tab_for_path, SAFE_METHODS, ROLE_EDIT_TABS, role_can_edit
from .analytics_shared import get_db

load_dotenv()
log = logging.getLogger("auth")

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
AUTH_SECRET = os.getenv("AUTH_SECRET", "")
TOKEN_HOURS = float(os.getenv("AUTH_TOKEN_HOURS", "8"))
ALGORITHM = "HS256"
MIN_PASSWORD_LENGTH = 10

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


def check_password_rules(password: str):
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")


# ─────────────────────────────────────────────
# DEPENDENCIES (used by main.py on every router)
# ─────────────────────────────────────────────
def _user_row(db: Session, user_id: int):
    return db.execute(
        text("SELECT id, username, full_name, role, is_active FROM app_users WHERE id = :id"),
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
    if not role_can_use(user["role"], tab):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Your role doesn't have access to this part of the dashboard.")
    if request.method not in SAFE_METHODS and not role_can_edit(user["role"], tab):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Your role has view-only access. You can't make changes here.")
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


class NewUserBody(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    full_name: str | None = None
    password: str
    role: str


class UpdateUserBody(BaseModel):
    full_name: str | None = None
    role: str | None = None
    is_active: bool | None = None
    new_password: str | None = None


def _public(user) -> dict:
    return {"id": user["id"], "username": user["username"], "full_name": user["full_name"],
            "role": user["role"], "tabs": ROLE_TABS.get(user["role"], []),
            "edit_tabs": ROLE_EDIT_TABS.get(user["role"], [])}

# ─────────────────────────────────────────────
# LOGIN / ME / OWN PASSWORD
# ─────────────────────────────────────────────
@router.post("/login")
def login(body: LoginBody, db: Session = Depends(get_db)):
    row = db.execute(
        text("SELECT id, username, full_name, role, is_active, password_hash "
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
    check_password_rules(body.new_password)
    db.execute(text("UPDATE app_users SET password_hash = :h WHERE id = :id"),
                {"h": hash_password(body.new_password), "id": user["id"]})
    db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────
# USER MANAGEMENT (admin only)
# ─────────────────────────────────────────────
@router.get("/users")
def list_users(_: dict = Depends(require_admin), db: Session = Depends(get_db)):
    rows = db.execute(text(
        "SELECT id, username, full_name, role, is_active, created_at, last_login_at "
        "FROM app_users ORDER BY username")).mappings().all()
    return [dict(r) for r in rows]


@router.post("/users", status_code=201)
def create_user(body: NewUserBody, _: dict = Depends(require_admin), db: Session = Depends(get_db)):
    if body.role not in ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Role must be one of: {', '.join(ROLES)}.")
    check_password_rules(body.password)
    exists = db.execute(text("SELECT 1 FROM app_users WHERE lower(username) = lower(:u)"),
                        {"u": body.username.strip()}).first()
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "That username is already taken.")
    new_id = db.execute(
        text("INSERT INTO app_users (username, full_name, password_hash, role) "
                "VALUES (:u, :n, :h, :r) RETURNING id"),
        {"u": body.username.strip(), "n": body.full_name, "h": hash_password(body.password),
        "r": body.role},
    ).scalar()
    db.commit()
    return {"id": new_id}


@router.patch("/users/{user_id}")
def update_user(user_id: int, body: UpdateUserBody, admin: dict = Depends(require_admin),
                db: Session = Depends(get_db)):
    if not _user_row(db, user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")
    if user_id == admin["id"] and (body.is_active is False or (body.role and body.role != "Admin")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "You can't disable or demote your own admin account.")
    sets, params = [], {"id": user_id}
    if body.full_name is not None:
        sets.append("full_name = :n"); params["n"] = body.full_name
    if body.role is not None:
        if body.role not in ROLES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Role must be one of: {', '.join(ROLES)}.")
        sets.append("role = :r"); params["r"] = body.role
    if body.is_active is not None:
        sets.append("is_active = :a"); params["a"] = body.is_active
    if body.new_password:
        check_password_rules(body.new_password)
        sets.append("password_hash = :h"); params["h"] = hash_password(body.new_password)
    if sets:
        db.execute(text(f"UPDATE app_users SET {', '.join(sets)} WHERE id = :id"), params)
        db.commit()
    return {"ok": True}
