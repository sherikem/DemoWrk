# DemoWrk

how to run backend 
uvicorn main:app --reload    

how to run frontend
npm install
then npm run


# DemoWrk dashboard — role-based access (starter implementation)

## What it does

- Login page before anything else. Username + password, stored as a bcrypt hash
  in a new Postgres table `app_users`.
- The backend checks the login AND the role on **every** API request (not just
  hidden tabs), so nobody can pull data by calling the API directly.
- Each role sees only its tabs. One rules file decides who sees what:
  `backend/postgres/access_rules.py`.
- Admins get a **Users** tab: add users, change roles, reset passwords,
  disable accounts. Users can't disable or demote themselves.
- Sessions last 8 hours, then the user logs in again. Disabling a user or
  changing their role takes effect on their next request.

## Assumed roles (edit `ROLE_TABS` in access_rules.py)

| Role | Tabs |
| --- | --- |
| Admin | everything + Users |
| Power-User | everything except Users |
| Read-Only | everything except editing dashboards |
| Finance | "finance", "villa_fees", "guest_revenue", "forecast" |

## Set up (on your own machine first, then the server)

From `backend\` with the venv active:

```powershell
pip install bcrypt PyJWT
python -c "import secrets;print(secrets.token_urlsafe(48))"
```

Add the printed value to `backend\.env`:

```
AUTH_SECRET=<the printed value>
AUTH_TOKEN_HOURS=8
```

Create the table and the first admin (prompts for username and password):

```powershell
python -m postgres.create_auth_tables
```

Start the backend as usual (`uvicorn main:app --reload --port 8000`). It refuses
to start if `AUTH_SECRET` is missing. Then `npm run dev` in the frontend, sign
in as the admin, and add the other users from the **Users** tab.
