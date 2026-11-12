# Shibra Campus Lite
Light front end for the existing Supabase project. No build step, no libraries. Same tables, RPCs, RLS and permissions as the old app.

Run: `npx serve .` then open the URL (not file://).
Deploy: GitHub Pages (Settings > Pages > main / root).
Change database: click the gear icon (login page or top bar), enter the new Project URL + publishable key, Test, Save.
The new project needs the same tables, `app_users` and RLS. Never put a service-role key in this app.
