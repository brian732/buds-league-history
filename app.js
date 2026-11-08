
const CONFIG_URL = 'data/league.json?v=20261107-tabs';
const CACHE_PREFIX = 'espn-436050287:v3:';


let DATA = null;      // league.json
let SEASONS = {};     // year -> { standings:[...], source:'espn' }
let SNAPSHOT = null;
let ESPN_HISTORY = null;
let HEAD_TO_HEAD = [];
let H2H_COVERAGE = [];
let CURRENT = null;   // normalized current ESPN season
let OWNER_BY_ID = {};

/* ---------- helpers ---------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (w, l, t = 0) => (w + l + t) ? ((w + t / 2) / (w + l + t)) : 0;
const fmt = n => Number(n).toFixed(2);

async function getJSON(url) {
  // Expire live data after five minutes; ignore the old unbounded cache.
  try {
    const cached = url === CONFIG_URL ? null : JSON.parse(sessionStorage.getItem(CACHE_PREFIX + url));
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.data;
  } catch (e) { /* storage unavailable or stale format */ }
  const r = await fetch(url, { cache: url === CONFIG_URL ? 'no-store' : 'no-cache', signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
  const j = await r.json();
  try { if (url !== CONFIG_URL) sessionStorage.setItem(CACHE_PREFIX + url, JSON.stringify({ at: Date.now(), data: j })); } catch (e) { /* quota; fine */ }
  return j;
}

/* ============================================================
   BOOT
   ============================================================ */
(async function init() {
  initTheme();
  initTabs();

  try {
    DATA = await getJSON(CONFIG_URL);
  } catch (e) {
    $('#nowStandings').innerHTML =
      `<p class="loading">Could not load <code>data/league.json</code>. ${esc(e.message)}</p>`;
    return;
  }

  if (!DATA.owners.length || !DATA.seasons.length) {
    $('#league-name').textContent = DATA.league.name;
    $('#league-est').textContent = 'ESPN · League 436050287';
    document.title = DATA.league.name + ' · History';
    $('#liveBadge').textContent = 'Awaiting league access';
    const message = '<p class="loading">This league’s ESPN history has not been imported yet. No records are shown until the source data is available.</p>';
    for (const id of ['nowStandings','trophyGrid','champTable','playoffTable','allTimeTable','h2hMatrix','gridHistory','ownerGrid','seasonBody','recordList','rulesBody','comparisonHistory','commissionerHistory']) { const el=$('#'+id); if(el)el.innerHTML=message; }
    for (const form of $$('form')) for (const el of [...form.elements]) el.disabled=true;
    renderInfo();renderFooter();return;
  }
  if (typeof initCustomization === 'function') initCustomization();

  DATA.owners.forEach(o => { OWNER_BY_ID[o.ownerId] = o; });

  document.title = `${DATA.league.name} · History`;
  $('#league-name').textContent = DATA.league.name;
  $('#league-est').textContent = DATA.league.established ? `est. ${DATA.league.established}` : 'ESPN Fantasy Football';

  // Things that need no network
  renderInfo();
  renderOwnersShell();
  renderSeasonsNav();
  renderRecords();
  renderRules();
  renderFooter();
  renderCommissionerHistory();

  // Things that do
  try { ESPN_HISTORY = await getJSON('data/espn-history.json'); } catch(e) { /* report missing coverage below */ }
  buildEspnSeasons();
  CURRENT = SEASONS[currentSeasonYear()]?.league || null;
  $('#liveBadge').textContent = ESPN_HISTORY?.updatedAt ? `ESPN · updated ${new Date(ESPN_HISTORY.updatedAt).toLocaleDateString()}` : 'ESPN archive';
  renderSeasonsNav();
  renderLive();
  renderAllTime();
  renderGridHistory();
  renderTrophies();
  renderOwnerRecords();
  renderSeason(currentSeasonYear());
  await loadHeadToHead();
  if (typeof loadPlayoffHistory === 'function') await loadPlayoffHistory();
  if (typeof initExplorer === 'function') initExplorer();
  renderAllTime();
  renderHeadToHead();
  if (typeof renderPersonalHome === 'function') renderPersonalHome();
})();

/* ============================================================
   SLEEPER
   ============================================================ */
function buildEspnSeasons() {
  (DATA.seasons || []).forEach(s => {
    if (SEASONS[s.year]) return;             // Do not duplicate imported years
    if (!s.standings) return;
    SEASONS[s.year] = {
      source: 'espn',
      league: {season:s.year,status:s.inProgress?'in_season':'complete',settings:{playoff_teams:s.playoffTeams}},
      standings: s.standings.map(r => ({
        ownerName: r.ownerName || ownerForTeamLabel(r.team),
        team: r.team,
        canonicalTeam: r.canonicalTeam || canonicalTeamFor(r.team),
        ownerId: r.ownerId || null,
        w: r.w, l: r.l, t: r.t || 0, pf: r.pf || 0, pa: r.pa || 0
      }))
    };
  });
}

/* Map historical/renamed team labels back to today's franchise. */
const TEAM_ALIASES = {};

function normLabel(s) {
  return String(s)
    .replace(/\s*\([^)]*\)\s*$/, '')            // strip "(PanFam)" hints
    .replace(/[‘’]/g, "'")
    .trim().toLowerCase();
}
function canonicalTeamFor(label) {
  return TEAM_ALIASES[normLabel(label)] || label;
}
function ownerForTeamLabel(label) {
  const canon = canonicalTeamFor(label);
  const o = DATA.owners.find(x => normLabel(x.team) === normLabel(canon));
  return o ? o.name : '';
}

function currentSeasonYear() {
  const yrs = (DATA.seasons || []).map(s => s.year);
  return Math.max(...yrs, ...Object.keys(SEASONS).map(Number));
}

/* ============================================================
   THIS SEASON
   ============================================================ */
function renderLive() {
  const yr = CURRENT ? +CURRENT.season : currentSeasonYear();
  const s = SEASONS[yr];
  const imported = ESPN_HISTORY?.seasons.find(s=>s.year===yr);
  $('#nowTitle').textContent = `${yr} Standings${imported?.completedPeriods ? ` · through Week ${imported.completedPeriods}` : ''}`;

  if (!s) { $('#nowStandings').innerHTML = '<p class="loading">No data for this season yet.</p>'; return; }

  const playoffTeams = (CURRENT && CURRENT.settings && CURRENT.settings.playoff_teams) || 4;

  const rows = s.standings.map((r, i) => `
    <tr class="${i === playoffTeams - 1 ? 'cut' : ''} ${typeof isFavorite === 'function' && isFavorite(r.ownerId) ? 'my-team-row' : ''}">
      <td class="rank">${i + 1}</td>
      <td>
        <span class="tname">${esc(r.team)}</span>
        ${i < playoffTeams ? '<span class="pill">Playoff</span>' : ''}
        <span class="oname">${esc(r.ownerName)}</span>
      </td>
      <td class="num">${r.w}-${r.l}${r.t ? '-' + r.t : ''}</td>
      <td class="num">${fmt(r.pf)}</td>
      <td class="num">${fmt(r.pa)}</td>
      <td class="num">${r.pa ? (r.pf - r.pa > 0 ? '+' : '') + fmt(r.pf - r.pa) : '—'}</td>
    </tr>`).join('');

  $('#nowStandings').innerHTML = `
    <div class="tbl-wrap"><table>
      <thead><tr>
        <th></th><th>Team</th>
        <th class="num">Record</th><th class="num">PF</th><th class="num">PA</th><th class="num">Diff</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="tiny" style="margin-top:.8rem">
      Top ${playoffTeams} make the playoffs (line shown). Based on the latest imported ESPN results.
    </p>`;
}

function renderInfo() {
  const L = DATA.league;
  $('#infoList').innerHTML = [
    ['Commissioner', esc(L.commissioner)],
    ['Platform', esc(L.platform)],
    ['Structure', esc(L.structure)],
    ['Entry fee', esc(L.entryFee)],
    ['Group chat', L.groupChat
      ? `<a href="${esc(L.groupChat.url)}" target="_blank" rel="noopener">${esc(L.groupChat.platform)} →</a>` : '—'],
    ['ESPN', `<a href="https://fantasy.espn.com/football/league?leagueId=${esc(L.espnLeagueId)}" target="_blank" rel="noopener">Open league →</a>`]
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  $('#payoutList').innerHTML = (L.payouts || [])
    .map(p => `<dt>${esc(p.place)}</dt><dd>${esc(p.amount)}</dd>`).join('');

  $('#punishList').innerHTML = (DATA.punishments || []).slice().reverse()
    .map(p => `<div><b>${p.year}</b><span>${esc(p.punishment)}${p.loser && p.loser !== '—' ? ` — <em>${esc(p.loser)}</em>` : ''}</span></div>`)
    .join('');
}

/* ============================================================
   TROPHY CASE
   ============================================================ */
function renderTrophies() {
  const seasons = (DATA.seasons || []).slice().sort((a, b) => b.year - a.year);

  $('#trophyGrid').innerHTML = seasons.map(s => {
    if (s.inProgress || !s.champion) {
      return `<div class="trophy live-season">
        <div class="yr">${s.year}</div>
        <div class="champ">In progress</div>
        <div class="who">Season underway</div>
      </div>`;
    }
    const owner = DATA.owners.find(o => normLabel(o.team) === normLabel(canonicalTeamFor(s.champion)));
    return `<div class="trophy">
      <div class="yr">${s.year}</div>
      <div class="champ">${esc(s.champion)}</div>
      <div class="who">${esc(owner ? owner.name : '')}</div>
      ${s.runnerUp ? `<div class="beat">def. ${esc(s.runnerUp)}</div>` : ''}
    </div>`;
  }).join('');

  // championship + playoff appearance tallies, computed from the season records
  const champ = Object.fromEntries(DATA.owners.map(o => [o.team, { w: 0, a: 0 }])), playoff = {};
  const bump = (o, k, f) => { o[k] = o[k] || { w: 0, a: 0 }; o[k][f]++; };

  seasons.forEach(s => {
    if (s.inProgress) return;
    if (s.champion)  { bump(champ, canonicalTeamFor(s.champion), 'a'); champ[canonicalTeamFor(s.champion)].w++; }
    if (s.runnerUp)  { bump(champ, canonicalTeamFor(s.runnerUp), 'a'); }
    ['champion', 'runnerUp', 'third', 'fourth'].forEach(k => {
      if (s[k]) { const t = canonicalTeamFor(s[k]); playoff[t] = (playoff[t] || 0) + 1; }
    });
  });

  $('#champTable').innerHTML = tallyTable(
    Object.entries(champ).sort((a, b) => b[1].w - a[1].w || b[1].a - a[1].a),
    ['Franchise', 'Titles', 'Appearances'],
    ([t, v]) => [teamCell(t), v.w ? '🏆'.repeat(v.w) + ` ${v.w}` : '0', v.a]
  );

  const allTeams = DATA.owners.map(o => o.team);
  $('#playoffTable').innerHTML = tallyTable(
    allTeams.map(t => [t, playoff[t] || 0]).sort((a, b) => b[1] - a[1]),
    ['Franchise', 'Playoff Berths'],
    ([t, n]) => [teamCell(t), n]
  );
}

function teamCell(team) {
  const o = DATA.owners.find(x => normLabel(x.team) === normLabel(team));
  return `${typeof ownerAvatar === 'function' && o ? ownerAvatar(o) : ''}<span class="tname">${esc(o?.displayTeam || team)}</span>${o ? `<span class="oname">${esc(o.name)}</span>` : ''}`;
}

function tallyTable(rows, heads, mapRow) {
  const body = rows.map((r, i) => {
    const cells = mapRow(r);
    return `<tr><td class="rank">${i + 1}</td>` +
      cells.map((c, j) => `<td class="${j === 0 ? '' : 'num'}">${c}</td>`).join('') + '</tr>';
  }).join('');
  return `<div class="tbl-wrap"><table>
    <thead><tr><th></th>${heads.map((h, j) => `<th class="${j === 0 ? '' : 'num'}">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

/* ============================================================
   ALL-TIME
   ============================================================ */
function allTimeTotals() {
  const tot = {};
  // Current and former owners retain their own ESPN history.
  const active = new Set(DATA.owners.map(o => normLabel(o.team)));
  Object.entries(SEASONS).forEach(([yr, s]) => {
    s.standings.forEach(r => {
      if (!active.has(normLabel(r.canonicalTeam))) return;
      const key = r.canonicalTeam;
      tot[key] = tot[key] || { team: key, w: 0, l: 0, t: 0, pf: 0, pa: 0, seasons: 0 };
      tot[key].w += r.w; tot[key].l += r.l; tot[key].t += r.t || 0;
      tot[key].pf += r.pf; tot[key].pa += r.pa || 0; tot[key].seasons++;
    });
  });
  return Object.values(tot).sort((a, b) => pct(b.w, b.l, b.t) - pct(a.w, a.l, a.t) || b.pf - a.pf);
}

function renderAllTime() {
  if (typeof renderExplorerStandings === 'function') return renderExplorerStandings();
  const rows = allTimeTotals();
  if (!rows.length) { $('#allTimeTable').innerHTML = '<p class="loading">No data.</p>'; return; }

  const titles = {};
  (DATA.seasons || []).forEach(s => {
    if (s.champion && !s.inProgress) {
      const t = canonicalTeamFor(s.champion);
      titles[t] = (titles[t] || 0) + 1;
    }
  });

  $('#allTimeTable').innerHTML = `<div class="tbl-wrap"><table>
    <thead><tr>
      <th></th><th>Franchise</th>
      <th class="num">W</th><th class="num">L</th><th class="num">T</th><th class="num">Pct</th>
      <th class="num">Seasons</th><th class="num">Total PF</th><th class="num">Total PA</th><th class="num">Titles</th>
    </tr></thead>
    <tbody>${rows.map((r, i) => `
      <tr>
        <td class="rank">${i + 1}</td>
        <td>${teamCell(r.team)}</td>
        <td class="num">${r.w}</td>
        <td class="num">${r.l}</td>
        <td class="num">${r.t}</td>
        <td class="num">${pct(r.w, r.l, r.t).toFixed(3).replace(/^0/, '')}</td>
        <td class="num">${r.seasons}</td>
        <td class="num">${fmt(r.pf)}</td>
        <td class="num">${fmt(r.pa)}</td>
        <td class="num">${titles[r.team] ? '🏆'.repeat(titles[r.team]) : '—'}</td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

function renderGridHistory() {
  if (typeof renderExplorerGrid === 'function') return renderExplorerGrid();
  const years = Object.keys(SEASONS).map(Number).filter(y => typeof selectedYear !== 'function' || selectedYear(y)).sort((a, b) => a - b);
  const teams = DATA.owners.map(o => o.team);

  const cell = (team, yr) => {
    const s = SEASONS[yr];
    if (!s) return '<td class="num">—</td>';
    const r = s.standings.find(x => normLabel(x.canonicalTeam) === normLabel(team));
    if (!r) return '<td class="num">—</td>';
    const season = (DATA.seasons || []).find(z => z.year === yr);
    const isChamp = season && season.champion && normLabel(canonicalTeamFor(season.champion)) === normLabel(team);
    return `<td class="num">${r.w}-${r.l}${r.t ? '-' + r.t : ''}${isChamp ? ' 🏆' : ''}</td>`;
  };

  $('#gridHistory').className = '';
  $('#gridHistory').innerHTML = `<div class="tbl-wrap"><table>
    <thead><tr><th>Franchise</th>${years.map(y => `<th class="num">${y}</th>`).join('')}</tr></thead>
    <tbody>${teams.map(t =>
      `<tr><td>${teamCell(t)}</td>${years.map(y => cell(t, y)).join('')}</tr>`).join('')}
    </tbody></table></div>`;
}

/* ============================================================
   OWNERS
   ============================================================ */
function renderOwnersShell() {
  $('#ownerGrid').innerHTML = DATA.owners.map(o => `
    <article class="owner" data-team="${esc(o.team)}">
      <div class="top">
        <div>
          ${typeof ownerAvatar === 'function' ? ownerAvatar(o, true) : ''}<h4>${esc(o.name)}</h4>
          <div class="team">${esc(o.displayTeam || o.team)}</div>
          <div class="role">${esc(o.role)}</div>
        </div>
        <div class="rings" data-rings></div>
      </div>
      <p class="school">${esc(o.school)}</p>
      <p class="bio">${esc(o.bio)}</p>
      ${o.hobbies ? `<div class="hob">${o.hobbies.map(h => `<em>${esc(h)}</em>`).join('')}</div>` : ''}
      <div class="rec" data-rec><span>Loading record…</span></div>
    </article>`).join('');

  $('#formerList').innerHTML = (DATA.formerOwners || [])
    .map(f => `<div><b>${esc(f.name)}</b><span>${esc(f.note)}</span></div>`).join('');
}

function renderOwnerRecords() {
  const tot = Object.fromEntries(allTimeTotals().map(r => [normLabel(r.team), r]));
  const titles = {};
  (DATA.seasons || []).forEach(s => {
    if (s.champion && !s.inProgress) {
      const t = normLabel(canonicalTeamFor(s.champion));
      titles[t] = (titles[t] || 0) + 1;
    }
  });

  $$('.owner').forEach(el => {
    const key = normLabel(el.dataset.team);
    const r = tot[key];
    el.querySelector('[data-rings]').textContent = titles[key] ? '🏆'.repeat(titles[key]) : '';
    el.querySelector('[data-rec]').innerHTML = r
      ? `<span>All-time <b>${r.w}-${r.l}${r.t ? '-' + r.t : ''}</b></span>
         <span>Win pct <b>${pct(r.w, r.l, r.t).toFixed(3).replace(/^0/, '')}</b></span>
         <span>Titles <b>${titles[key] || 0}</b></span>`
      : '<span>No record data</span>';
  });
}

/* ============================================================
   SEASON ARCHIVE
   ============================================================ */
function renderSeasonsNav() {
  const years = [...new Set([...(DATA.seasons || []).map(s => s.year), ...Object.keys(SEASONS).map(Number)])].sort((a, b) => b - a);
  $('#yearNav').innerHTML = years.map(y => `<button data-year="${y}">${y}</button>`).join('');
  $('#yearNav').onclick = e => {
    const b = e.target.closest('button[data-year]');
    if (b) renderSeason(+b.dataset.year);
  };
}

function renderSeason(year) {
  $$('#yearNav button').forEach(b => b.classList.toggle('active', +b.dataset.year === year));
  const s = (DATA.seasons || []).find(x => x.year === year) || (SEASONS[year] && { year, inProgress: SEASONS[year].league?.status !== 'complete' });
  if (!s) return;

  const live = SEASONS[year];
  const slots = [
    ['Champion', s.champion, 'win'],
    ['Runner-up', s.runnerUp, ''],
    ['3rd', s.third, ''],
    ['4th', s.fourth, ''],
    ['Last place', s.dfl, 'dfl']
  ].filter(x => x[1]);

  let html = '';

  if (slots.length) {
    html += `<div class="season-head">${slots.map(([lbl, val, cls]) =>
      `<div class="slot ${cls}"><div class="lbl">${lbl}</div><div class="val">${esc(val)}</div></div>`).join('')}</div>`;
  }

  if (s.notableEvents) {
    html += `<div class="notable"><b>Notable events</b>${esc(s.notableEvents)}</div>`;
  }

  if (s.recap) html += `<p class="recap">${esc(s.recap)}</p>`;

  if (live) {
    const knownStandings=live.standings.filter(r=>OWNER_BY_ID[r.ownerId]);
    const showPA = knownStandings.some(r => r.pa > 0);
    if(knownStandings.length!==live.standings.length)html+='<p class="tiny">Showing listed owners only. Their records include games against the former owner who is excluded from this site.</p>';
    html += `<h3 class="sub">${s.inProgress ? 'Current' : 'Final'} Standings <span class="pill">Verified via ESPN</span></h3>`;
    html += `<div class="tbl-wrap"><table>
      <thead><tr><th></th><th>Team</th><th class="num">Record</th><th class="num">PF</th>${showPA ? '<th class="num">PA</th>' : ''}</tr></thead>
      <tbody>${knownStandings.map((r, i) => `
        <tr><td class="rank">${i + 1}</td>
          <td><span class="tname">${esc(r.team)}</span><span class="oname">${esc(r.ownerName)}</span></td>
          <td class="num">${r.w}-${r.l}${r.t ? '-' + r.t : ''}</td>
          <td class="num">${r.pf ? fmt(r.pf) : '—'}</td>
          ${showPA ? `<td class="num">${r.pa ? fmt(r.pa) : '—'}</td>` : ''}
        </tr>`).join('')}
      </tbody></table></div>`;
  }

  if (s.awards && s.awards.length) {
    html += `<h3 class="sub">League Awards</h3><div class="awards">${s.awards.map(a => `
      <div class="aw">
        <div class="t">${esc(a.award)}</div>
        <div class="w">${esc(a.winner)}</div>
        ${a.detail ? `<div class="d">${esc(a.detail)}</div>` : ''}
      </div>`).join('')}</div>`;
  }

  if (s.meeting || (s.ruleChanges && s.ruleChanges.length)) {
    html += `<h3 class="sub">League Meeting</h3><div class="meeting">`;
    if (s.meeting) {
      if (s.meeting.title)  html += `<h3>${esc(s.meeting.title)}</h3>`;
      if (s.meeting.detail) html += `<p>${esc(s.meeting.detail)}</p>`;
      if (s.meeting.election) html += `<p><strong>Commissioner election.</strong> ${esc(s.meeting.election)}</p>`;
      if (s.meeting.tally) {
        html += `<div class="tally">${s.meeting.tally.map(t =>
          `<div><b>${esc(t.voter)}</b><span>${esc(t.vote)}</span></div>`).join('')}</div>`;
      }
    }
    if (s.ruleChanges && s.ruleChanges.length) {
      html += `<p style="margin-top:1.2rem"><strong>Rule changes</strong></p>
        <ul class="rc">${s.ruleChanges.map(r => `<li>${esc(r)}</li>`).join('')}</ul>`;
    }
    html += `</div>`;
  }

  $('#seasonBody').innerHTML = html;
}

/* ============================================================
   RECORD BOOK
   ============================================================ */
function renderRecords() {
  $('#recordList').innerHTML = (DATA.recordBook || []).map(r => `
    <div class="rec-row">
      <div class="v">${esc(r.value)}</div>
      <div class="meta">
        <div class="lbl">${esc(r.record)} ${r.verified
          ? '<span class="pill">Verified</span>'
          : '<span class="pill gray">Unverified</span>'}</div>
        <div class="hold">${esc(r.holder)}</div>
        <div class="when">${esc(r.when)}</div>
      </div>
      ${r.note ? `<div class="note">${esc(r.note)}</div>` : ''}
    </div>`).join('');
}

/* ============================================================
   RULEBOOK
   ============================================================ */
function renderRules() {
  if (!$('#rulesBody')) return;
  const R = DATA.rules || {};
  let html = '';

  if (R.scoring) {
    html += `<div class="rule-block"><h3 class="sub" style="margin-top:0">Scoring</h3>`;
    if (R.scoring.summary) html += `<p class="sumry">${esc(R.scoring.summary)}</p>`;
    html += `<div class="score-grid">${(R.scoring.groups || []).map(g => `
      <div class="score-card">
        <h4>${esc(g.name)}</h4>
        <ul>${g.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      </div>`).join('')}</div></div>`;
  }

  const blocks = [
    ['Draft', R.draft], ['Trades', R.trades], ['Waiver Acquisitions', R.waivers],
    ['Playoff Structure', R.playoffs], ['Miscellaneous Rules', R.misc], ['Annual Meeting', R.annualMeeting]
  ];
  blocks.forEach(([title, list]) => {
    if (!list || !list.length) return;
    html += `<div class="rule-block"><h3 class="sub">${esc(title)}</h3>
      <ul class="rules">${list.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  });

  $('#rulesBody').innerHTML = html;
}

function renderFooter() {
  const L = DATA.league;
  $('#footNote').innerHTML =
    `${esc(L.name)}${L.established ? ` (est. ${L.established})` : ""} · Commissioner ${esc(L.commissioner)}` +
    (L.address ? ` · ${esc(L.address)}` : '');
}

/* ============================================================
   UI PLUMBING
   ============================================================ */
function initTabs() {
  const go = name => {
    if (!$('#tab-' + name)) name = 'now';
    $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
    if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (b) go(b.dataset.tab);
  });
  window.switchLeagueTab = go;
  const h = location.hash.slice(1);
  go(h || 'now');
  window.addEventListener('hashchange', () => {
    const n = location.hash.slice(1);
    go(n || 'now');
  });
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('espn-436050287-theme'); } catch (e) { /* private mode */ }
  if (saved) document.documentElement.dataset.theme = saved;
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('espn-436050287-theme', next); } catch (e) { /* ignore */ }
    if (typeof syncThemePreference === 'function') syncThemePreference(next);
  });
}

/* ---------- verified regular-season head-to-head history ---------- */
async function loadHeadToHead() {
  HEAD_TO_HEAD = [];
  H2H_COVERAGE = [];
  const tasks = [];
  (ESPN_HISTORY?.seasons || []).forEach(season => {
    const teams = Object.fromEntries(season.teams.map(t => [t.teamId, t]));
    let excluded = 0;
    season.games.forEach(g => {
      const a = teams[g.homeTeamId]?.ownerId;
      const b = teams[g.awayTeamId]?.ownerId;
      if (!OWNER_BY_ID[a] || !OWNER_BY_ID[b]) { excluded++; return; }
      HEAD_TO_HEAD.push({ year: season.year, week: g.week, a, b, ap: g.hp, bp: g.ap, winner:g.winner });
    });
    const loaded = new Set(season.games.map(g => g.week)).size;
    H2H_COVERAGE.push({ year: season.year, weeks: season.completedPeriods ?? season.regularWeeks, loaded, saved: 0,
      missing: (season.completedPeriods ?? season.regularWeeks) - loaded, excluded });
  });

}

function headToHeadRecord(owner, opponent) {
  const record = { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
  (typeof filteredGames === 'function' ? filteredGames() : HEAD_TO_HEAD).forEach(g => {
    if (!((g.a === owner && g.b === opponent) || (g.b === owner && g.a === opponent))) return;
    const [pf, pa] = g.a === owner ? [g.ap, g.bp] : [g.bp, g.ap];
    record.pf += pf / 100; record.pa += pa / 100;
    if (pf > pa || (pf === pa && g.winner === owner)) record.w++;
    else if (pf < pa || (pf === pa && g.winner === opponent)) record.l++; else record.t++;
  });
  return record;
}
function headToHeadTotal(owner) {
  return DATA.owners.filter(o => o.ownerId !== owner).reduce((total, o) => {
    const r = headToHeadRecord(owner, o.ownerId);
    for (const k of ['w', 'l', 't', 'pf', 'pa']) total[k] += r[k];
    return total;
  }, { w: 0, l: 0, t: 0, pf: 0, pa: 0 });
}
const recordLabel = r => `${r.w}–${r.l}–${r.t}`;

function renderHeadToHead() {
  const owners = DATA.owners;
  const coverage = H2H_COVERAGE.filter(c => typeof selectedYear !== 'function' || selectedYear(c.year)).sort((a, b) => a.year - b.year);
  $('#h2hCoverage').textContent = explorerCoverage();
  if (!HEAD_TO_HEAD.length && !(typeof PLAYOFF_GAMES !== 'undefined' && PLAYOFF_GAMES.length)) {
    $('#h2hMatrix').innerHTML = '<p>No completed matchup data available.</p>';
    return;
  }
  $('#h2hMatrix').className = '';
  $('#h2hMatrix').innerHTML = `<div class="tbl-wrap h2h-scroll" tabindex="0" role="region" aria-label="Head-to-head records, scroll horizontally to see every owner"><table class="h2h-table">
    <caption>${typeof competitionLabel === 'function' ? esc(competitionLabel()) : 'Regular-season'} head-to-head · row owner's W–L–T</caption>
    <thead><tr><th scope="col">Owner</th>${owners.map(o => `<th scope="col">${esc(o.name)}</th>`).join('')}<th scope="col">Total vs listed owners</th></tr></thead>
    <tbody>${owners.map(o => `<tr><th scope="row">${esc(o.name)}</th>${owners.map(other => {
      if (o === other) return '<td class="num h2h-self" aria-label="Same owner">—</td>';
      const r = headToHeadRecord(o.ownerId, other.ownerId);
      return `<td class="num ${r.w > r.l ? 'h2h-winning' : ''}" title="${esc(o.name)} vs ${esc(other.name)}">${recordLabel(r)}</td>`;
    }).join('')}<td class="num">${recordLabel(headToHeadTotal(o.ownerId))}</td></tr>`).join('')}</tbody></table></div>`;
  const selectedOwner = $('#h2hOwner').value;
  $('#h2hOwner').innerHTML = owners.map(o => `<option value="${esc(o.ownerId)}">${esc(o.name)}</option>`).join('');
  if (owners.some(o => o.ownerId === selectedOwner)) $('#h2hOwner').value = selectedOwner;
  $('#h2hOwner').onchange = renderHeadToHeadDetail;
  renderHeadToHeadDetail();
}

function renderHeadToHeadDetail() {
  const owner = $('#h2hOwner').value;
  $('#h2hDetail').innerHTML = `<p class="tiny">Total against listed owners: <b>${recordLabel(headToHeadTotal(owner))}</b>. Games against the excluded former owner are omitted here.</p>` + tallyTable(DATA.owners.filter(o => o.ownerId !== owner),
    ['Opponent', 'W–L–T', 'Win %', 'Points For', 'Points Against'], o => {
      const r = headToHeadRecord(owner, o.ownerId);
      return [`<span class="tname">${esc(o.name)}</span><span class="oname">${esc(o.team)}</span>`, recordLabel(r),
        r.w + r.l + r.t ? pct(r.w, r.l, r.t).toFixed(3) : '—', fmt(r.pf), fmt(r.pa)];
    });
}

/* Written terms are kept in league.json, separate from the editing desk. */
function renderCommissionerHistory() {
  if (!$('#commissionerHistory')) return;
  if (!(DATA.league.commissionerHistory || []).length) { $('#commissionerHistory').innerHTML='<p class="loading">Commissioner history has not been recorded yet.</p>'; return; }
  $('#commissionerHistory').innerHTML = (DATA.league.commissionerHistory || []).map(term => {
    const owner = DATA.owners.find(o => o.name === term.name);
    const years = term.startYear === term.endYear ? term.startYear : `${term.startYear}–${term.endYear}`;
    const seasons = term.endYear - term.startYear + 1;
    const current = term.name === DATA.league.commissioner;
    return `<li class="commissioner-term ${current ? 'current' : ''}"><div class="term-years">${esc(years)}<span>${seasons} season${seasons === 1 ? '' : 's'}</span></div><div class="term-person">${owner && typeof ownerAvatar === 'function' ? ownerAvatar(owner, true) : ''}<div><h3>${esc(term.name)}</h3>${owner ? `<p>${esc(owner.displayTeam || owner.team)}</p>` : ''}</div></div>${current ? '<span class="pill">Current commissioner</span>' : ''}</li>`;
  }).join('');
}
