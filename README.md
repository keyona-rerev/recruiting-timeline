# Recruiting Timeline Checker (T032)

An Athlete Site Pixie (Tool Registry T032). The "are we behind?" timeline-anxiety play. A parent enters their name, email, sport, graduation year (and optionally current grade); the tool computes against today's date and returns an On Track / Crunch Time / Behind verdict, what should already be done, what is next, and the key NCAA dates ahead. Every run captures a lead in Supabase, emails the parent their card, and fires an internal notification.

Forked file-for-file from T030 Scholarship Reality; only the engine, inputs, and card output changed.

The calendar and milestones are **deterministic** from sourced rules (current 2025-26, pulled live at build from the NCAA recruiting calendar and the NCSA Eligibility Center checklist). The athlete's grade is computed from grad year vs. today, then milestones are tagged should-be-done / focus-this-year / coming-up. Claude Haiku only writes the three narrative reads around those facts; templated fallback so the tool never hard-fails. No web search.

## What's where

- `index.html` — the tool people use (sport, grad year, optional grade)
- `report.html` — the shareable result card, with Download-as-PNG; reached at `/report.html?t=TOKEN`
- `netlify/functions/timeline.js` — runs a report: validate, Turnstile, compute grade + milestones, Haiku reads, save to Supabase, email parent + notify you
- `netlify/functions/get-report.js` — reads one saved card by its token
- `supabase.sql` — the leads/results table (`timeline_reports`)

## What it computes

- **Grade** from grad year and today's date (entering grade for the upcoming school year).
- **Milestones** by grade (NCAA Profile/Certification account, core-course lock-in, film, coach outreach, camps, visits, offers, amateurism, signing, final transcript), each tagged should-be-done / focus-this-year / coming-up.
- **NCAA contact windows** by sport (when comms open and official visits open). Football, basketball, baseball/softball, lacrosse, and men's hockey diverge from the standard "June 15 after sophomore year / Aug 1 before junior year" rule; those are baked in.
- **Test status:** standardized tests are NOT required for NCAA initial eligibility (noted in the reads); individual colleges may still want them.

## Setup (one time)

Reuses the existing `online-report-card` Supabase project (shared with T028/T030/T031), so `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are already valid — the `timeline_reports` table is already applied live.

### Netlify
1. Add a new site from this GitHub repo (the one manual OAuth step). Build settings come from `netlify.toml`.
2. Site configuration -> Environment variables: copy `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` from the T030 site; set `DAILY_CAP` (e.g. `200`), `EMAIL_FROM` (`Athlete Site <reports@rerev.io>`), `EMAIL_REPLY_TO` (`keyona@rerev.io`), `LEAD_NOTIFY_TO` (`keyona@rerev.io`); paste `RESEND_API_KEY` once; add a fresh `TURNSTILE_SECRET` for this domain.
3. In `index.html`, replace `YOUR_TURNSTILE_SITE_KEY` with the new widget's Site key.
4. Deploy.

## How the emails work
- The **parent** gets a clean-subject email: "{First}, your recruiting timeline check," with a link to their card.
- **You** get a second email on every lead, subject `[T032 · Recruiting Timeline] New lead - {name}, {sport} class of {year} ({verdict})`.

## Guards in place
All secrets server-side; required name + email gate; Cloudflare Turnstile; daily cap + per-IP rate limit (4 / 10 min); 30-day result cache (same email + sport + grad year); server-side validation + HTML-escaped rendering; shareable pages keyed by an unguessable token; leads table private behind RLS.

## Notes
- NCAA calendars vary by sport and change; the card carries a "confirm at ncaa.org" line.
- Engine swap vs T030: a grade-and-milestone timeline engine instead of the scholarship-money tables. Everything else mirrors the chassis.
