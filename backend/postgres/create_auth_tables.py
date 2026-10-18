# backend/postgres/create_auth_tables.py
"""
Creates the app_users table for dashboard logins and (optionally) an admin
account. Safe to run again: the table is only created if missing, and an
existing username is never overwritten.

Run from backend/ with the venv active:
    python -m postgres.create_auth_tables              # create table + prompt for an admin
    python -m postgres.create_auth_tables --no-admin   # create table only

The password is typed at a hidden prompt and stored as a bcrypt hash.
Never put passwords in code, git or .env.
"""
import argparse
import getpass
import sys

import bcrypt
from sqlalchemy import text

from postgres.database import engine

DDL = """
CREATE TABLE IF NOT EXISTS app_users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(100) UNIQUE NOT NULL,
    full_name     VARCHAR(200),
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(30)  NOT NULL
                  CHECK (role IN ('Admin', 'Read-Only', 'Power-User', 'Finance')),
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_lower ON app_users (lower(username));
"""


def main():
    parser = argparse.ArgumentParser(description="Create the dashboard login table and an admin user.")
    parser.add_argument("--no-admin", action="store_true", help="Only create the table.")
    args = parser.parse_args()

    with engine.begin() as conn:
        conn.execute(text(DDL))
    print("app_users table ready.")

    if args.no_admin:
        return

    username = input("Admin username: ").strip()
    full_name = input("Full name (optional): ").strip() or None
    password = getpass.getpass("Password (min 10 characters): ")
    if len(username) < 3 or len(password) < 10:
        sys.exit("Username needs 3+ characters and password 10+. Nothing created.")
    if getpass.getpass("Repeat password: ") != password:
        sys.exit("Passwords don't match. Nothing created.")

    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    with engine.begin() as conn:
        taken = conn.execute(text("SELECT 1 FROM app_users WHERE lower(username) = lower(:u)"),
                             {"u": username}).first()
        if taken:
            sys.exit(f"User '{username}' already exists. Nothing changed.")
        conn.execute(
            text("INSERT INTO app_users (username, full_name, password_hash, role) "
                 "VALUES (:u, :n, :h, 'Admin')"),
            {"u": username, "n": full_name, "h": password_hash},
        )
    print(f"Admin '{username}' created. Log in to the dashboard and add the other users from Users.")


if __name__ == "__main__":
    main()
