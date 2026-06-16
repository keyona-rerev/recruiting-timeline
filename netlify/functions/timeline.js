// Netlify Function: POST /api/report
// Recruiting Timeline Checker (T032) — a ReRev Labs / Athlete Site Pixie.
// DETERMINISTIC milestone + NCAA-calendar rules (sourced live June 2026 from the
// current NCSA/NCAA recruiting calendar and Eligibility Center checklist). Everything
// computes against today's date. Haiku (temp 0, no web search) writes ONLY the three
// narrative reads around the computed facts; templated fallback so it never hard-fails.
// Guards mirror T030: validate -> Turnstile -> daily cap -> per-IP -> 30d cache
//   -> compute -> narrative -> save (+token) -> email parent + notify internally.

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj),
});

const stripTags = (s) => String(s == null ? '' : s)
  .replace(/<\/?cite[^>]*>/gi, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// ---------- sport calendar (current 2025-26 / 2026-27; NCAA D1 first-contact + visit windows) ----------
const SPORTS = {
  football:  { label: 'Football', comms: 'Sept 1 of junior year', visits: 'Apr 1 of junior year', tag: 'Football diverges: calls open Sept 1 junior year, official visits Apr 1 junior year.' },
  mbb:       { label: "Men's Basketball", comms: 'June 15 after sophomore year', visits: 'Aug 1 before junior year', tag: '' },
  wbb:       { label: "Women's Basketball", comms: 'June 1 after sophomore year (electronic)', visits: 'Jan 1 of junior year', tag: '' },
  mhockey:   { label: "Men's Ice Hockey", comms: 'Jan 1 of sophomore year', visits: 'Aug 1 before junior year', tag: 'Men’s hockey is the earliest in the NCAA: comms open Jan 1 of sophomore year.' },
  baseball:  { label: 'Baseball', comms: 'Aug 1 before junior year (electronic); offers Sept 1', visits: 'Sept 1 of junior year', tag: '' },
  softball:  { label: 'Softball', comms: 'Sept 1 of junior year', visits: 'Sept 1 of junior year', tag: '' },
  lacrosse:  { label: 'Lacrosse', comms: 'Sept 1 of junior year', visits: 'Sept 1 of junior year', tag: '' },
  swim:      { label: 'Swimming & Diving', comms: 'June 15 after sophomore year', visits: 'Aug 1 before junior year', tag: '' },
  track:     { label: 'Track & Field / XC', comms: 'June 15 after sophomore year', visits: 'Aug 1 before junior year', tag: '' },
  soccer:    { label: 'Soccer', comms: 'June 15 after sophomore year', visits: 'Aug 1 before junior year', tag: '' },
  volleyball:{ label: 'Volleyball', comms: 'June 15 after sophomore year', visits: 'Aug 1 before junior year', tag: '' },
  other:     { label: 'Other D1 sport', comms: 'June 15 after sophomore year', visits: 'Aug 1 before junior year', tag: 'Using the standard "all other D1 sports" rule; confirm your sport’s exact calendar.' },
};

// ---------- milestone timeline by grade (NCSA Eligibility Center checklist + best practice) ----------
const MILESTONES = [
  { grade: 9,  cat: 'Eligibility Center', text: 'Create your free NCAA Profile Page account' },
  { grade: 9,  cat: 'Core courses',       text: 'Get your school’s NCAA-approved core-course list; take a core class in each subject' },
  { grade: 9,  cat: 'Film',               text: 'Start capturing game and competition footage' },
  { grade: 10, cat: 'Film',               text: 'Cut a real 2-4 minute highlight video, best plays first' },
  { grade: 10, cat: 'Coach outreach',     text: 'Build your target-school list and start emailing coaches' },
  { grade: 10, cat: 'Camps',              text: 'Attend showcases, combines, and college camps at target schools' },
  { grade: 11, cat: 'Eligibility Center', text: 'Upgrade to the paid NCAA Certification Account' },
  { grade: 11, cat: 'Core courses',       text: 'Lock in 10 of 16 core courses (7 in English/Math/Science) by end of junior year — DI freezes these grades' },
  { grade: 11, cat: 'Visits',             text: 'Take official and unofficial visits; have real coach conversations' },
  { grade: 11, cat: 'Offers',             text: 'Pursue verbal commitments and offers where the fit is right' },
  { grade: 11, cat: 'Film',               text: 'Refresh your highlight film with junior-season footage' },
  { grade: 12, cat: 'Amateurism',         text: 'Complete the amateurism questionnaire and request final certification (Apr 1 for fall enrollees)' },
  { grade: 12, cat: 'Commit & sign',      text: 'Finalize your decision and sign in the appropriate signing window' },
  { grade: 12, cat: 'Transcripts',        text: 'Have your counselor send the final transcript and proof of graduation' },
];

const GRADE_NAME = { 9: 'freshman', 10: 'sophomore', 11: 'junior', 12: 'senior' };

function computeGrade(gradYear, now) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const springYear = m >= 7 ? y + 1 : y;        // academic year currently ending
  const completed = 12 - (gradYear - springYear); // grade just completed
  const entering = completed + 1;                  // grade for the upcoming school year
  return { completed, entering, springYear };
}

function buildBase(sportKey, gradYear, now, overrideGrade) {
  const s = SPORTS[sportKey];
  const g = computeGrade(gradYear, now);
  let entering = overrideGrade && overrideGrade >= 8 && overrideGrade <= 13 ? overrideGrade : g.entering;
  const graduated = entering > 12;

  let hero, heroSub, verdict;
  if (graduated) {
    hero = 'Behind'; verdict = 'Past the high-school recruiting window';
    heroSub = 'class of ' + gradYear + ' — the HS recruiting window has largely closed';
  } else if (entering <= 10) {
    hero = 'On Track'; verdict = entering <= 9 ? 'Foundation phase — time is on your side' : 'Build phase — time is on your side';
    heroSub = 'entering ' + (GRADE_NAME[Math.max(9, entering)] || 'high school') + ' year';
  } else if (entering === 11) {
    hero = 'Crunch Time'; verdict = 'Junior year — the biggest contact windows open now';
    heroSub = 'entering junior year';
  } else {
    hero = 'Crunch Time'; verdict = 'Senior year — finalize and sign';
    heroSub = 'entering senior year';
  }

  const curGradeForTagging = graduated ? 13 : entering;
  const mark = (grade) => grade < curGradeForTagging ? '✓ should be done' : (grade === curGradeForTagging ? '▶ focus this year' : '· coming up');

  // rows: milestones with status, plus the sport's key dates
  const rows = MILESTONES.map(ms => ({
    label: ms.cat,
    value: ms.text + '  (' + mark(ms.grade) + ')',
    accent: ms.grade === curGradeForTagging,
  }));
  rows.push({ label: 'Key date · comms open', value: s.comms, accent: false });
  rows.push({ label: 'Key date · official visits', value: s.visits, accent: false });

  // the three things to do now
  let focus = MILESTONES.filter(ms => ms.grade === curGradeForTagging).map(ms => ms.text);
  if (focus.length < 3) {
    const overdue = MILESTONES.filter(ms => ms.grade < curGradeForTagging).map(ms => ms.text);
    focus = (graduated ? overdue.slice(-3) : focus.concat(overdue.slice(-(3 - focus.length))));
  }
  focus = focus.slice(0, 3);

  const first_read = graduated
    ? 'For the class of ' + gradYear + ', the traditional high-school recruiting window has largely closed. The honest move now is the transfer/portal path, junior-college route, or walk-on and prove-it conversations.'
    : 'You are entering ' + (GRADE_NAME[Math.max(9, entering)] || 'high school') + ' year in ' + s.label + '. For your D1 sport, recruiting comms open ' + s.comms + ' and official visits open ' + s.visits + '.';

  return { s, gradYear, entering, graduated, hero, heroSub, verdict, rows, focus, first_read };
}

function templatedReads(b) {
  const focusList = b.focus.length ? b.focus.join('; ') : 'keep building film, grades, and your target list';
  return {
    where: 'Right now you are at ' + b.hero.toLowerCase() + ' for the class of ' + b.gradYear + '. ' + (b.graduated ? 'The standard window has passed, so the plan shifts to portal, JUCO, or walk-on routes.' : 'That is measured purely against the calendar, not against anyone else.'),
    now: 'The three things to focus on right now: ' + focusList + '. Do these before anything else.',
    dates: b.graduated ? 'Because the NCAA contact windows for your class have closed, the key dates that matter now are college transfer and JUCO timelines, not the high-school calendar.' : 'Watch your dates: comms open ' + b.s.comms + ' and official visits open ' + b.s.visits + ' for your sport. ' + (b.s.tag || 'Calendars vary by sport, so confirm yours.'),
  };
}

async function aiReads(b, key) {
  const prompt =
`You are writing three short, honest paragraphs for a parent using a college-recruiting timeline tool. Use ONLY the facts below. Do not invent dates or rules. Warm, plain, direct, a little urgent where warranted. No markdown, no lists, no headers, no em dashes.

FACTS
- Sport: ${b.s.label}. Graduation class: ${b.gradYear}.
- Status: ${b.hero} (${b.verdict}).
- ${b.graduated ? 'The high-school recruiting window has largely closed for this class.' : 'Entering grade phase: ' + b.heroSub + '.'}
- NCAA comms open: ${b.s.comms}. Official visits open: ${b.s.visits}.
- The three things to do right now: ${b.focus.join('; ')}.
- Standardized test scores are NOT required for NCAA initial eligibility, though individual colleges may still want them.

Return ONLY a JSON object, no fences and no preamble, exactly:
{"where":"2-3 sentences on where they honestly are","now":"2-3 sentences naming the three things to do this month","dates":"2-3 sentences on the key dates and what is next"}`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 700, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await r.json();
    if (!r.ok || data.error) return null;
    const text = (data.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const o = JSON.parse(m[0]);
    if (!o.where || !o.now || !o.dates) return null;
    return { where: stripTags(o.where), now: stripTags(o.now), dates: stripTags(o.dates) };
  } catch (e) { return null; }
}

async function emailParent({ to, firstName, clean, shareUrl, key, from, replyTo }) {
  const html =
`<div style="font-family:Arial,Helvetica,sans-serif;background:#0A0A0A;color:#FFFFFF;padding:32px;border-radius:4px;max-width:520px;margin:0 auto;border:1px solid #2A2A2A">
  <div style="font-family:monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#6f6f6f">Athlete Site / Recruiting Timeline Checker</div>
  <h1 style="font-size:22px;font-weight:800;margin:14px 0 6px;letter-spacing:-.02em">${firstName}, here is where the recruiting clock stands.</h1>
  <p style="font-size:15px;line-height:1.5;color:#B8B8B8;margin:0 0 18px">An honest read on the recruiting timeline for the class of ${clean.grad_year}, computed against today.</p>
  <div style="border-left:3px solid #FF4D00;padding-left:14px;margin:0 0 22px">
    <div style="font-size:20px;font-weight:700">${clean.hero}</div>
    <div style="font-size:14px;color:#B8B8B8;margin-top:6px;line-height:1.5">${clean.first_read}</div>
  </div>
  <a href="${shareUrl}" style="display:inline-block;background:#FF4D00;color:#0A0A0A;text-decoration:none;font-family:monospace;font-weight:600;font-size:13px;letter-spacing:.06em;text-transform:uppercase;padding:13px 24px;border-radius:2px">View your full timeline &rarr;</a>
  <p style="font-size:12px;color:#6f6f6f;margin:26px 0 0;line-height:1.5">NCAA calendars vary by sport and change; confirm specifics at ncaa.org. You can download your card from the link above.</p>
</div>`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject: `${firstName}, your recruiting timeline check`, html }),
  });
}

async function notifyInternal({ lead, clean, shareUrl, key, from, notifyTo }) {
  const subject = `[T032 · Recruiting Timeline] New lead - ${lead.full_name}, ${clean.sport_label} class of ${clean.grad_year} (${clean.hero})`;
  const html =
`<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;line-height:1.6">
  <p><b>New Recruiting Timeline lead.</b></p>
  <p>Name: ${lead.full_name}<br>Email: ${lead.email}<br>Sport: ${clean.sport_label}<br>Grad year: ${clean.grad_year}</p>
  <p>Verdict: ${clean.hero} — ${clean.verdict}</p>
  <p><a href="${shareUrl}">View their card</a></p>
</div>`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [notifyTo], subject, html }),
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Bad request.' }); }

  const fullName = String(body.full_name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const sport = String(body.sport || '').trim();
  const gradYear = parseInt(body.grad_year, 10);
  const overrideGrade = body.current_grade ? parseInt(body.current_grade, 10) : null;
  const token = String(body.turnstile_token || '');

  if (!fullName || fullName.length > 80) return json(400, { error: 'Please enter the parent or athlete name.' });
  if (email.length > 120 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'Please enter a valid email.' });
  if (!SPORTS[sport]) return json(400, { error: 'Please pick a sport from the list.' });
  if (!(gradYear >= 2024 && gradYear <= 2035)) return json(400, { error: 'Please enter a graduation year between 2024 and 2035.' });

  const { ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, TURNSTILE_SECRET, DAILY_CAP, RESEND_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO, LEAD_NOTIFY_TO } = process.env;
  const cap = parseInt(DAILY_CAP || '200', 10);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return json(500, { error: 'The tool is not fully configured yet.' });

  const ip = (event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const base = 'https://' + (event.headers.host || 'recruiting-timeline.netlify.app');

  if (TURNSTILE_SECRET) {
    try {
      const form = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token });
      if (ip) form.append('remoteip', ip);
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
      const j = await r.json();
      if (!j.success) return json(403, { error: 'Could not verify you are human. Please try again.' });
    } catch { return json(403, { error: 'Could not verify you are human. Please try again.' }); }
  }

  const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const countOf = (res) => parseInt((res.headers.get('content-range') || '*/0').split('/')[1] || '0', 10);

  try {
    const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
    const r = await sb(`timeline_reports?select=id&created_at=gte.${startOfDay.toISOString()}`, { headers: { Prefer: 'count=exact', Range: '0-0' } });
    if (countOf(r) >= cap) return json(429, { error: "We're at capacity for today. Check back tomorrow." });
  } catch (e) {}

  if (ip) {
    try {
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const r = await sb(`timeline_reports?select=id&ip=eq.${encodeURIComponent(ip)}&created_at=gte.${since}`, { headers: { Prefer: 'count=exact', Range: '0-0' } });
      if (countOf(r) >= 4) return json(429, { error: "You've run a few already. Give it a minute." });
    } catch (e) {}
  }

  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const r = await sb(`timeline_reports?select=report,token&email=eq.${encodeURIComponent(email)}&sport=eq.${encodeURIComponent(sport)}&grad_year=eq.${gradYear}&created_at=gte.${since}&order=created_at.desc&limit=1`);
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length && rows[0].report) {
      return json(200, { ...rows[0].report, token: rows[0].token || null, share_path: rows[0].token ? `/report.html?t=${rows[0].token}` : null, cached: true });
    }
  } catch (e) {}

  const b = buildBase(sport, gradYear, new Date(), overrideGrade);
  let reads = ANTHROPIC_API_KEY ? await aiReads(b, ANTHROPIC_API_KEY) : null;
  if (!reads) reads = templatedReads(b);

  const cap600 = (s) => stripTags(s).slice(0, 600);
  const clean = {
    sport_label: b.s.label,
    grad_year: gradYear,
    who: b.s.label + ' · Class of ' + gradYear,
    hero: stripTags(b.hero).slice(0, 40),
    hero_small: b.hero.length > 10,
    hero_sub: stripTags(b.heroSub).slice(0, 80),
    verdict: stripTags(b.verdict).slice(0, 120),
    first_read: stripTags(b.first_read).slice(0, 280),
    rows: b.rows.map(r => ({ label: stripTags(r.label).slice(0, 60), value: stripTags(r.value).slice(0, 160), accent: !!r.accent })),
    reads: [
      { kicker: 'Where you are', text: cap600(reads.where) },
      { kicker: 'Do this month', text: cap600(reads.now) },
      { kicker: 'The dates ahead', text: cap600(reads.dates) },
    ],
  };

  const reportToken = (globalThis.crypto && globalThis.crypto.randomUUID)
    ? globalThis.crypto.randomUUID()
    : (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  try {
    await sb('timeline_reports', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ full_name: fullName, email, sport, grad_year: gradYear, verdict: clean.hero + ' — ' + clean.verdict, report: clean, ip: ip || null, token: reportToken }),
    });
  } catch (e) {}

  const shareUrl = `${base}/report.html?t=${reportToken}`;
  if (RESEND_API_KEY) {
    const from = EMAIL_FROM || 'onboarding@resend.dev';
    const replyTo = EMAIL_REPLY_TO || 'keyona@rerev.io';
    const firstName = (fullName.split(' ')[0] || 'there').slice(0, 40);
    try { await emailParent({ to: email, firstName, clean, shareUrl, key: RESEND_API_KEY, from, replyTo }); } catch (e) {}
    try { await notifyInternal({ lead: { full_name: fullName, email }, clean, shareUrl, key: RESEND_API_KEY, from, notifyTo: LEAD_NOTIFY_TO || replyTo }); } catch (e) {}
  }

  return json(200, { ...clean, token: reportToken, share_path: `/report.html?t=${reportToken}` });
};
