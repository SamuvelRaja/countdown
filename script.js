// Small goal calendar UI for static hosting
// - Reads `goals.json` to render a card per goal
// - Each day is a tile (7 columns for Sun-Sat)
// - Hovering a tile shows the score 0-10
// - Week row label shows average for that week
// - Countdown updates every minute

import { formatDistanceStrict } from './utils.js';

const app = document.getElementById('goals');

async function loadGoals() {
    const r = await fetch('goals.json');
    const goals = await r.json();
    return goals;
}

function toIso(date) {
    // Build a local YYYY-MM-DD (no UTC shift) so keys match goals.json
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
}

function startOfWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const diff = d.getDay();
    d.setDate(d.getDate() - diff); // sunday
    return d;
}

function endOfWeek(date) {
    const s = startOfWeek(date);
    return addDays(s, 6);
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function scoreToClass(score) {
    if (Number.isNaN(score)) return 'c-0 disabled';
    const s = clamp(Math.round(score), 0, 10);
    return `c-${s}`;
}

function parseJSONScores(obj) {
    // obj may be a mapping of iso -> score
    return obj || {};
}

// small tooltip singleton
const tooltipEl = (() => {
    const el = document.createElement('div');
    el.className = 'tooltip hidden';
    document.body.appendChild(el);
    return el;
})();

function showTooltip(x, y, html) {
    tooltipEl.innerHTML = html;
    tooltipEl.style.left = `${x}px`;
    tooltipEl.style.top = `${y}px`;
    tooltipEl.classList.remove('hidden');
}
function hideTooltip() { tooltipEl.classList.add('hidden'); }

function calcDaysBetween(a, b) {
    const A = new Date(a.toDateString());
    const B = new Date(b.toDateString());
    return Math.round((+B - +A) / 86400000);
}

function createTileEl({ iso, score, inRange, isPastOrToday, defaultScore, autoDefault }) {
    const d = document.createElement('div');
    const baseClass = 'tile';
    // If the day is in-range and past-or-today and score is null/NaN,
    // treat it as the base default (2 unless overridden by goal.defaultScore)
    // and map to the standard color ramp so intensity reflects that value.
    const displayScore = (inRange && isPastOrToday) ? (Number.isNaN(score) ? (defaultScore ?? 2) : score) : score;
    const scoreClass = (inRange && isPastOrToday) ? scoreToClass(displayScore) : 'future';
    d.className = `${baseClass} ${scoreClass}`;
    d.dataset.date = iso;
    // only attach a numeric dataset.score when there is an actual stored numeric score
    d.dataset.score = (inRange && isPastOrToday && !Number.isNaN(score)) ? score : '';
    d.setAttribute('role', 'button');
    d.setAttribute('aria-label', `${iso}${inRange ? ' score ' + (Number.isNaN(score) ? String(defaultScore ?? 2) + ' (default)' : score) : ' (outside range)'}`);
    if (!inRange) {
        // hide out-of-range days but keep grid spacing
        d.classList.remove('future');
        d.classList.add('spacer');
        d.setAttribute('aria-hidden', 'true');
    } else if (!isPastOrToday) {
        d.classList.add('disabled'); // visually grey & non-interactive
    } else {
        d.style.cursor = 'pointer';
    }
    return d;
}

function makeMonthPills(weeks, tileSize, gap) {
    // weeks: array of Date - first day of each week
    const segments = [];
    let cur = null;
    for (let i = 0; i < weeks.length; i++) {
        const firstDay = weeks[i];
        const label = firstDay.toLocaleString('en', { month: 'short' });
        if (!cur || cur.label !== label) {
            cur = { label, start: i, count: 1 };
            segments.push(cur);
        } else {
            cur.count++;
        }
    }

    const pillEls = segments.map(s => {
        const el = document.createElement('div');
        el.className = 'month-pill';
        el.textContent = s.label;
        const width = s.count * tileSize + (s.count - 1) * gap;
        el.style.width = `${width}px`;
        return el;
    });
    return pillEls;
}

function createGoalCard(goal) {
    const tpl = document.getElementById('goal-card-template');
    const card = tpl.content.cloneNode(true);
    const root = card.querySelector('.goal-card');
    const title = root.querySelector('.goal-title');
    const cd = root.querySelector('.goal-countdown');
    const daysPastEl = root.querySelector('.days-past');
    const daysLeftEl = root.querySelector('.days-left');
    const cal = root.querySelector('.calendar');
    const monthsEl = root.querySelector('.months');

    title.textContent = goal.title;

    // make the "Passed" counter visibly light-green by default
    // allow override from goals.json: either `passedColor` (CSS color string)
    // or `passedIntensity` (0..10) which maps to the same ramp used by tiles
    daysPastEl.classList.add('days-past--highlight');
    if (goal.passedColor) {
        daysPastEl.style.color = goal.passedColor;
    } else if (goal.passedIntensity !== undefined && Number.isFinite(Number(goal.passedIntensity))) {
        const palette = ['#2a2f3e', '#1a4233', '#1d6944', '#1e8b56', '#1fac66', '#22c978', '#2ee68a', '#45ee9b', '#5ff5ab', '#7dfabc', '#9affce'];
        const idx = clamp(Math.round(Number(goal.passedIntensity)), 0, 10);
        daysPastEl.style.color = palette[idx];
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Start range: if not specified, begin at the 16th of the current month
    // (e.g., November 16 this month).
    const startDate = goal.startDate ? new Date(goal.startDate) : new Date(today.getFullYear(), today.getMonth(), 16);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(goal.endDate);
    endDate.setHours(0, 0, 0, 0);

    // Week rows should run Sun–Sat. Start from the first Sunday ON or AFTER
    // the chosen startDate (e.g., 2025-11-16 for a startDate of 2025-11-15).
    const displayStart = (startDate.getDay() === 0)
        ? startDate
        : addDays(startDate, (7 - startDate.getDay()) % 7);
    const displayEnd = endOfWeek(endDate);

    // iterate days between displayStart..displayEnd
    const dates = [];
    for (let d = new Date(displayStart); d <= displayEnd; d.setDate(d.getDate() + 1)) {
        dates.push(new Date(d));
    }

    const tileSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--tile-size'));
    const gap = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--tile-gap'));

    const jsonScores = parseJSONScores(goal.scores);
    const saved = jsonScores; // no client-side persistence

    const tilesByDate = {};
    const weekData = []; // array of {scores: [n|NaN], dates: [iso]}

    // build tiles: only past/today get default scores; future stays NaN
    for (let i = 0; i < dates.length; i++) {
        const d = dates[i];
        const iso = toIso(d);
        const inRange = d >= startDate && d <= endDate;
        const isPastOrToday = d <= today;

        let score;
        let autoDefault = false;
        if (saved[iso] !== undefined && saved[iso] !== null && !Number.isNaN(Number(saved[iso]))) {
            score = Number(saved[iso]);
        } else if (inRange && isPastOrToday) {
            score = goal.defaultScore ?? 2;
            autoDefault = true; // visually mark as light green
        } else {
            score = NaN; // future or out-of-range
        }

        tilesByDate[iso] = { date: new Date(d), iso, score, inRange, autoDefault };
    }

    // Do not auto-persist defaults to localStorage. We keep past/today tiles
    // visually logged (light green) and use default scores for averages, but
    // only store values when the user explicitly clicks a tile.

    // rebuild weekData based on tilesByDate (only past/today contribute scores)
    for (let i = 0; i < dates.length; i++) {
        const d = dates[i];
        const iso = toIso(d);
        const td = tilesByDate[iso];
        const wk = Math.floor(i / 7);
        const pos = i % 7;
        if (!weekData[wk]) weekData[wk] = { scores: new Array(7).fill(NaN), dates: new Array(7).fill(null) };
        weekData[wk].dates[pos] = iso;
        weekData[wk].scores[pos] = (!Number.isNaN(td.score) && td.date <= today && td.inRange) ? td.score : NaN;
    }

    // Create month pills
    const weeks = [];
    for (let w = 0; w < weekData.length; w++) {
        const firstDateIso = weekData[w].dates[0];
        const dd = new Date(firstDateIso + 'T00:00:00');
        weeks.push(new Date(dd));
    }
    const pillEls = makeMonthPills(weeks, tileSize, gap);
    pillEls.forEach(p => monthsEl.appendChild(p));

    // create rows (week rows) and labels
    for (let r = 0; r < weekData.length; r++) {
        const row = document.createElement('div');
        row.className = 'week-row';

        const grid = document.createElement('div');
        grid.className = 'tiles-grid';

        // week label — create early so closures can reference it
        const weekScoresNow = weekData[r].scores.filter(s => !Number.isNaN(s));
        const avgInit = (weekScoresNow.length ? (weekScoresNow.reduce((a, b) => a + b, 0) / weekScoresNow.length).toFixed(1) : '--');
        const label = document.createElement('div');
        label.className = 'week-label';
        label.textContent = `${getWeekLabel(r + 1)} (${avgInit})`;
        label.title = `Week ${r + 1} average: ${avgInit}`;
        label.addEventListener('mouseenter', () => {
            const wkScoresDQ = weekData[r].scores.filter(s => !Number.isNaN(s));
            const avgDQ = (wkScoresDQ.length ? (wkScoresDQ.reduce((a, b) => a + b, 0) / wkScoresDQ.length).toFixed(1) : '--');
            const rect = label.getBoundingClientRect();
            showTooltip(rect.left + rect.width / 2, rect.top - 8, `Week ${r + 1} average: ${avgDQ}`);
        });
        label.addEventListener('mouseleave', hideTooltip);

        for (let c = 0; c < 7; c++) {
            const iso = weekData[r].dates[c];
            // If this slot is outside the date range (because we don't round
            // the start to the week's Sunday), render an invisible spacer cell.
            if (!iso) {
                const empty = document.createElement('div');
                empty.className = 'tile spacer';
                empty.setAttribute('aria-hidden', 'true');
                grid.appendChild(empty);
                continue;
            }
            const td = tilesByDate[iso];
            const isPastOrToday = td.date <= today;
            const tileEl = createTileEl({ iso, score: td.score, inRange: td.inRange, isPastOrToday, defaultScore: goal.defaultScore ?? 2, autoDefault: td.autoDefault });

            // Skip wiring events for hidden out-of-range cells
            if (!td.inRange) {
                grid.appendChild(tileEl);
                continue;
            }

            tileEl.addEventListener('mouseenter', () => {
                const wkScores = weekData[r].scores.filter(s => !Number.isNaN(s));
                const weekAvg = (wkScores.length ? (wkScores.reduce((a, b) => a + b, 0) / wkScores.length).toFixed(1) : '--');
                const displayScore = (td.inRange && isPastOrToday) ? (Number.isNaN(td.score) ? (goal.defaultScore ?? 2) : td.score) : td.score;
                const isDefaultish = Number.isNaN(td.score) || td.autoDefault;
                const scoreText = td.inRange && isPastOrToday ? `Score: ${displayScore}${isDefaultish ? ' (default)' : ''}` : (td.inRange ? 'Future day' : 'Outside range');
                const html = `${iso} — ${scoreText} <div style="opacity:.8;font-size:11px;margin-top:3px">Week ${r + 1} • avg ${weekAvg}</div>`;
                const rect = tileEl.getBoundingClientRect();
                showTooltip(rect.left + rect.width / 2, rect.top - 8, html);
            });
            tileEl.addEventListener('mouseleave', hideTooltip);

            tileEl.addEventListener('click', () => {
                if (!td.inRange || td.date > today) return; // disable future clicks
                td.score = (Number.isNaN(td.score) ? (goal.defaultScore ?? 2) : td.score + 1);
                if (td.score > 10) td.score = 0;
                tileEl.className = `tile ${scoreToClass(td.score)}`; // clicking makes it an explicit score
                tileEl.dataset.score = td.score;
                // update week data and label average
                const posIdx = weekData[r].dates.indexOf(iso);
                if (posIdx !== -1) weekData[r].scores[posIdx] = td.score;
                const wkScores = weekData[r].scores.filter(s => !Number.isNaN(s));
                const avg = (wkScores.length ? (wkScores.reduce((a, b) => a + b, 0) / wkScores.length).toFixed(1) : '--');
                label.textContent = `${getWeekLabel(r + 1)} (${avg})`;
                label.title = `Week ${r + 1} average: ${avg}`;
            });

            grid.appendChild(tileEl);
        }

        row.appendChild(grid);
        row.appendChild(label);
        cal.appendChild(row);
    }

    // stats & countdown
    function updateCounts() {
        const now = new Date();
        // count passed days as the number of in-range days up to today
        // (treating unscored past days as implicitly logged/green for display)
        const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const passedDays = Object.values(tilesByDate).filter(td => td.inRange && td.date <= todayLocal).length;
        const leftDays = Math.max(0, calcDaysBetween(now, endDate));
        daysPastEl.textContent = passedDays;
        daysLeftEl.textContent = leftDays;
        cd.textContent = formatDistanceStrict(now, endDate);
    }
    updateCounts();
    setInterval(updateCounts, 60 * 1000);

    return root;
}

function getWeekLabel(n) { return `W${n}`; }

// main
loadGoals().then(goals => {
    goals.map(createGoalCard).forEach(card => app.appendChild(card));
});
