# backend/postgres/form_rules.py
"""
Rules for the names and passwords typed into the user forms (Users tab,
change-password). The ONE place the backend defines them; the same rules are
mirrored in frontend/src/auth/formRules.js so the form can show them live.
The backend is the authority: it re-checks everything.

Each function returns a list of plain-English problems. An empty list means OK.
auth.py turns a non-empty list into a 400 response.

To change a rule, edit the constants below (and the matching ones in
formRules.js).
"""
import re

# ── Names ─────────────────────────────────────────────────────────
NAME_MIN = 2
NAME_MAX = 50
# Letters (any language), with single spaces, hyphens, apostrophes or periods
# between letter groups: Mary-Jane, O'Brien, De La Cruz, St. John, José.
_NAME_RE = re.compile(r"^[^\W\d_]+(?:[ '’.\-]+[^\W\d_]+)*\.?$")

# ── Passwords ─────────────────────────────────────────────────────
PASSWORD_MIN = 8
PASSWORD_MAX_BYTES = 72   # bcrypt cannot use more than this
# The password may not contain any run of this many characters (or more)
# copied from the username, first name or last name. 4 = "more than 3".
SHARED_RUN = 4


def clean_name(value) -> str:
    """Trim and collapse repeated spaces. Does not change capitalisation."""
    return re.sub(r"\s+", " ", (value or "").strip())


def name_problems(value, label="Name") -> list:
    name = clean_name(value)
    if not name:
        return [f"{label} is required"]
    problems = []
    if len(name) < NAME_MIN:
        problems.append(f"{label} must be at least {NAME_MIN} letters")
    if len(name) > NAME_MAX:
        problems.append(f"{label} must be at most {NAME_MAX} characters")
    if not _NAME_RE.match(name):
        problems.append(f"{label} may contain only letters, spaces, hyphens, "
                        "apostrophes and periods, and must start with a letter")
    return problems


def shares_run(password, pieces) -> bool:
    """True if the password contains SHARED_RUN+ characters in a row that
    also appear (in the same order) in any of the given pieces."""
    low = (password or "").lower()
    for piece in pieces:
        for word in (piece or "").lower().split():
            for i in range(len(word) - SHARED_RUN + 1):
                if word[i:i + SHARED_RUN] in low:
                    return True
    return False


def password_problems(password, username="", names=()) -> list:
    password = password or ""
    problems = []

    if len(password) < PASSWORD_MIN:
        problems.append(f"Password must be at least {PASSWORD_MIN} characters")
    if len(password.encode("utf-8")) > PASSWORD_MAX_BYTES:
        problems.append(f"Password must be at most {PASSWORD_MAX_BYTES} bytes "
                        "(about that many characters)")
    if not any(c.islower() for c in password):
        problems.append("Password needs a lowercase letter")
    if not any(c.isupper() for c in password):
        problems.append("Password needs an uppercase letter")
    if not any(c.isdigit() for c in password):
        problems.append("Password needs a number")
    if not any(not c.isalnum() and not c.isspace() for c in password):
        problems.append("Password needs a special character (such as ! ? # $ %)")
    if shares_run(password, [username, *names]):
        problems.append(
            f"Password must not contain {SHARED_RUN} or more characters in a "
            "row from the username, first name or last name")
    return problems