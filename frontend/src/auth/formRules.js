// frontend/src/auth/formRules.js
// ─────────────────────────────────────────────────────────────────
// Name and password rules for the user forms. These MIRROR
// backend/postgres/form_rules.py so the form can show them while the
// person types. The backend re-checks everything, so if the two ever
// disagree the backend wins. Change a rule in BOTH files.
//
// Each function returns a list of plain-English problems ([] = OK).
// ─────────────────────────────────────────────────────────────────

export const NAME_MIN = 2;
export const NAME_MAX = 50;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX_BYTES = 72;
// Password may not contain this many characters (or more) in a row copied
// from the username, first name or last name. 4 = "more than 3".
export const SHARED_RUN = 4;

// Letters (any language) with single spaces, hyphens, apostrophes or periods
// between letter groups: Mary-Jane, O'Brien, De La Cruz, St. John, José.
const NAME_RE = /^\p{L}+(?:[ '’.-]+\p{L}+)*\.?$/u;

export const cleanName = (value) => (value || "").trim().replace(/\s+/g, " ");

export function nameProblems(value, label = "Name") {
  const name = cleanName(value);
  if (!name) return [`${label} is required`];
  const problems = [];
  if ([...name].length < NAME_MIN) problems.push(`${label} must be at least ${NAME_MIN} letters`);
  if ([...name].length > NAME_MAX) problems.push(`${label} must be at most ${NAME_MAX} characters`);
  if (!NAME_RE.test(name)) {
    problems.push(
      `${label} may contain only letters, spaces, hyphens, apostrophes and periods, and must start with a letter`,
    );
  }
  return problems;
}

function sharesRun(password, pieces) {
  const low = (password || "").toLowerCase();
  return pieces.some((piece) =>
    (piece || "").toLowerCase().split(/\s+/).filter(Boolean).some((word) => {
      for (let i = 0; i + SHARED_RUN <= word.length; i += 1) {
        if (low.includes(word.slice(i, i + SHARED_RUN))) return true;
      }
      return false;
    }),
  );
}

// One entry per rule so the form can show a live checklist:
// [{ label: "At least 8 characters", ok: true }, ...]
export function passwordChecklist(password, { username = "", names = [] } = {}) {
  const pw = password || "";
  const tooLong = new TextEncoder().encode(pw).length > PASSWORD_MAX_BYTES;
  const items = [
    { label: `At least ${PASSWORD_MIN} characters`, ok: [...pw].length >= PASSWORD_MIN },
    { label: "At least one lowercase letter", ok: /\p{Ll}/u.test(pw) },
    { label: "At least one uppercase letter", ok: /\p{Lu}/u.test(pw) },
    { label: "At least one number", ok: /\p{Nd}/u.test(pw) },
    { label: "At least one special character (! ? # $ %)", ok: /[^\p{L}\p{N}\s]/u.test(pw) },
    {
      label: `No ${SHARED_RUN}+ characters in a row from the username or name`,
      ok: !sharesRun(pw, [username, ...names]),
    },
  ];
  // Only shows up if someone pastes something enormous.
  if (tooLong) items.push({ label: `No more than ${PASSWORD_MAX_BYTES} characters`, ok: false });
  return items;
}

export function passwordProblems(password, context = {}) {
  if (!password) return ["Password is required"];
  return passwordChecklist(password, context)
    .filter((r) => !r.ok)
    .map((r) => r.label);
}