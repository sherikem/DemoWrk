# backend/postgres/create_auth_tables.py
"""
Creates the app_users table for dashboard logins and (optionally) an admin
account. Safe to run again: the table is only created if missing, an existing
table is upgraded to the current layout, and an existing username is never
overwritten.

Run from backend/ with the venv active:
    python -m postgres.create_auth_tables              # create/upgrade table + prompt for an admin
    python -m postgres.create_auth_tables --no-admin   # create/upgrade table only
    python -m postgres.create_auth_tables --reset      # DELETE every user, rebuild the table, create an admin

The password is typed at a hidden prompt and stored as a bcrypt hash.
It must follow the same rules as the Users tab (postgres/form_rules.py).
Never put passwords in code, git or .env.

Columns:
  permissions  JSONB, NULL = "follow the role's preset" (see access_rules.py).
               Set per user from the Users tab; NULL for most people.
"""
import argparse
import getpass
import sys

import bcrypt
from sqlalchemy import text

from postgres.database import engine
from postgres.form_rules import clean_name, name_problems, password_problems

# Must match ROLES in access_rules.py and in UsersAdmin.jsx EXACTLY.
ROLES = ["Admin", "Power-User", "Read-Only", "Finance", "Sales Power-User"]
ROLE_LIST_SQL = ", ".join("'" + r + "'" for r in ROLES)

DDL = f"""
CREATE TABLE IF NOT EXISTS app_users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(100) UNIQUE NOT NULL,
    full_name     VARCHAR(200),
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(30)  NOT NULL,
    permissions   JSONB,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMP
);
-- Upgrade a table made by an older version of this script.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS permissions JSONB;
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_role_check CHECK (role IN ({ROLE_LIST_SQL}));
CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_lower ON app_users (lower(username));
"""


def reset_table():
    """Drop app_users after the person types a confirmation phrase."""
    print("\nThis permanently deletes EVERY dashboard user and password.")
    if input('Type  DELETE ALL USERS  to continue: ').strip() != "DELETE ALL USERS":
        sys.exit("Not confirmed. Nothing changed.")
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS app_users"))
    print("Old app_users table dropped.")


def ask_admin():
    username = input("Admin username (3+ characters): ").strip()
    first = clean_name(input("First name: "))
    last = clean_name(input("Last name: "))
    problems = []
    if len(username) < 3:
        problems.append("Username needs 3 or more characters")
    problems += name_problems(first, "First name") + name_problems(last, "Last name")
    if problems:
        sys.exit("; ".join(problems) + ". Nothing created.")

    password = getpass.getpass("Password: ")
    problems = password_problems(password, username, [first, last])
    if problems:
        sys.exit("; ".join(problems) + ". Nothing created.")
    if getpass.getpass("Repeat password: ") != password:
        sys.exit("Passwords don't match. Nothing created.")
    return username, f"{first} {last}", password


def main():
    parser = argparse.ArgumentParser(description="Create the dashboard login table and an admin user.")
    parser.add_argument("--no-admin", action="store_true", help="Only create/upgrade the table.")
    parser.add_argument("--reset", action="store_true",
                        help="Delete every user and rebuild the table (asks to confirm).")
    args = parser.parse_args()

    if args.reset:
        reset_table()

    with engine.begin() as conn:
        conn.execute(text(DDL))
    print("app_users table ready (with permissions column and 5 roles).")

    if args.no_admin:
        return

    username, full_name, password = ask_admin()
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