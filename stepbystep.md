1. register Aiven pg
2. .env
    DATABASE_URL=postgresql+psycopg2://avnadmin:pwd@pg-service-aixpertlab.k.aivencloud.com:21906/defaultdb?sslmode=require
3. (verirag) PS B:\veriRAG> uv run python -c "from app.infra.database import engine; print(engine.connect().exec_driver_sql('select version()').scalar())"
PostgreSQL 18.7 on x86_64-pc-linux-gnu, compiled by gcc (GCC) 15.3.1 20260722 (Red Hat 15.3.1-1), 64-bit
4. uv run --frozen alembic upgrade head   
5. (verirag) PS B:\veriRAG> uv run --frozen python -c "from app.infra.database import assert_schema_current; assert_schema_current(); print('schema current')"

*6. The flow in frontend_veriRAG/src/App.tsx is:*
1. The app restores its own session on startup. restoreAuthSession() calls the backend’s /auth/refresh endpoint using a refresh-token cookie. If that succeeds, the app has a backend session; if not, it shows the login form.
2. On login, Supabase checks the email and password. signInWithPassword() returns a Supabase access token. Registration uses signUp(); if email verification is needed, the app shows a notice and stops here.
3. The frontend exchanges the Supabase token with the backend. It posts the token to /auth/supabase/exchange.
4. The backend verifies the token with Supabase. It gets the verified user ID and confirmed email, then finds or creates the corresponding local user.
5. The backend creates its own session. It returns an access token and sets a refresh-token cookie. The frontend signs out of the local Supabase client, then saves the backend session with installAuthSession().
6. The app loads the signed-in workspace. It lists the user’s threads and fetches the capability catalog. Subsequent API requests use the backend access token; when needed, the app refreshes it through the refresh-token cookie.
So the short version is: Supabase verifies the credentials; then your backend verifies the Supabase token, maps the user, and issues the session used by the app.


