"""
Reset a user's password directly in the database.

Run from backend/:
    python -m postgres.reset_password admin
"""
import sys
from getpass import getpass

import bcrypt
from sqlalchemy import text

from postgres.database import engine


def main():
    if len(sys.argv) != 2:
        print("Usage: python -m postgres.reset_password <username>")
        sys.exit(1)

    username = sys.argv[1].strip().lower()

    with engine.begin() as conn:
        row = conn.execute(
            text("select id, role, is_active from app_users where lower(username) = :u"),
            {"u": username},
        ).fetchone()
        if not row:
            print(f"No user named '{username}'. Existing users:")
            for r in conn.execute(text("select username, role, is_active from app_users order by username")):
                print(f"  {r.username}  role={r.role}  active={r.is_active}")
            sys.exit(1)

        pw1 = getpass("New password (min 10 characters): ")
        pw2 = getpass("Repeat password: ")
        if pw1 != pw2:
            print("Passwords do not match. Nothing changed.")
            sys.exit(1)
        if len(pw1) < 10:
            print("Too short. Nothing changed.")
            sys.exit(1)

        hashed = bcrypt.hashpw(pw1.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        conn.execute(
            text("update app_users set password_hash = :h, is_active = true where id = :id"),
            {"h": hashed, "id": row.id},
        )

    print(f"Password reset for '{username}' (role: {row.role}). Account is active.")


if __name__ == "__main__":
    main()