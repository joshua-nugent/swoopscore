const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Cell values: null = untouched, 0 = explicit zero, number = scored
let game = { mode: "rounds", target: 6, highWins: false, players: [], rounds: [] };

// --- Undo ---
// In-memory only (a reload starts a fresh history, but the game itself is
// restored from localStorage). Each entry is a snapshot of everything the
// scoring screen can mutate.

const UNDO_LIMIT = 40;
let undoStack = [];
let lastEditKey = null;  // cell whose consecutive keystrokes are one undo step

function snapshot() {
  return JSON.stringify({ rounds: game.rounds, target: game.target });
}

function pushUndo(state) {
  undoStack.push(state || snapshot());
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  refreshToolButtons();
}

// Group consecutive keystrokes in one cell into a single undo step: only the
// first keystroke of a new editing session banks the pre-edit state.
function bankEdit(key, before) {
  if (key === lastEditKey) return;
  lastEditKey = key;
  pushUndo(before);
}

function undo() {
  const prev = undoStack.pop();
  if (prev === undefined) return;
  const state = JSON.parse(prev);
  game.rounds = state.rounds;
  game.target = state.target;
  lastEditKey = null;
  updateGameInfo();
  renderGrid();
  refreshToolButtons();
  saveGame();
}

function refreshToolButtons() {
  $("#undo").disabled = undoStack.length === 0;
  $("#remove-round").disabled = game.rounds.length <= 1;
}

// --- Recent names (localStorage) ---

const STORAGE_KEY = "swoopscore_recent_names";
const GAME_KEY = "swoopscore_current_game";

// --- Persisted game state ---
// The full game lives only in memory; without this it's lost whenever the
// browser reloads or discards the tab (common on mobile after inactivity).

function saveGame() {
  try {
    localStorage.setItem(GAME_KEY, JSON.stringify(game));
  } catch (e) {
    // Fail loud: don't pretend the game is safe if we couldn't store it.
    console.warn("SwoopScore: could not save game state — progress may be lost on reload.", e);
  }
}

function clearSavedGame() {
  try {
    localStorage.removeItem(GAME_KEY);
  } catch { /* nothing to clear */ }
}

function getRecentNames() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch { return []; }
}

function saveRecentNames(names) {
  const existing = getRecentNames();
  const merged = [...names, ...existing];
  const seen = new Set();
  const unique = merged.filter((n) => {
    const key = n.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(unique.slice(0, 20)));
}

function deleteRecentName(name) {
  const remaining = getRecentNames().filter(
    (n) => n.toLowerCase() !== name.toLowerCase()
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
  renderRecentNames();
  // Say so out loud — a tile vanishing with no explanation reads like a bug.
  showPlayerNotice(`Removed "${name}" from saved names.`);
}

function closeIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 14 14");
  svg.setAttribute("width", "13");
  svg.setAttribute("height", "13");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M3 3 L11 11 M11 3 L3 11");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("fill", "none");
  svg.appendChild(path);
  return svg;
}

function renderRecentNames() {
  const container = $("#recent-names");
  container.replaceChildren();
  const names = getRecentNames();
  if (names.length === 0) return;

  names.forEach((name) => {
    const tile = document.createElement("div");
    tile.className = "name-tile";
    tile.dataset.name = name;

    const nameBtn = document.createElement("button");
    nameBtn.className = "tile-name";
    nameBtn.type = "button";
    nameBtn.textContent = name;
    nameBtn.addEventListener("click", () => {
      // On refusal the warning is already up; refreshing would wipe it.
      if (!addPlayerWithName(name)) return;
      updateDeckInfo();
      refreshPlayerState();
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "tile-remove";
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", `Remove ${name}`);
    // Drawn rather than typeset: a text glyph here depends on the loaded font
    // and on line-height/appearance quirks that differ on mobile.
    removeBtn.appendChild(closeIcon());
    removeBtn.addEventListener("click", () => deleteRecentName(name));

    tile.append(nameBtn, removeBtn);
    container.appendChild(tile);
  });

  refreshPlayerState();
}

function nameKey(name) {
  return name.trim().toLowerCase();
}

function seatedNames() {
  return [...$$(".player-name")]
    .map((inp) => inp.value.trim())
    .filter((v) => v !== "");
}

function addPlayerWithName(name) {
  if (seatedNames().some((n) => nameKey(n) === nameKey(name))) {
    showPlayerWarning(`${name} is already in this game.`);
    return false;
  }
  const emptyInput = [...$$(".player-name")].find((inp) => inp.value.trim() === "");
  if (emptyInput) {
    emptyInput.value = name;
    return true;
  }
  appendPlayerRow(name);
  return true;
}

function showPlayerWarning(text) {
  const warn = $("#player-warning");
  warn.textContent = text;
  warn.classList.remove("hidden", "notice");
}

function showPlayerNotice(text) {
  const warn = $("#player-warning");
  warn.textContent = text;
  warn.classList.remove("hidden");
  warn.classList.add("notice");
}

// Two players sharing a name make the score grid ambiguous, so flag duplicates
// as they are typed and grey out recent-name tiles that are already seated.
// Returns true when the roster is usable.
function refreshPlayerState() {
  const inputs = [...$$(".player-name")];
  const counts = new Map();
  inputs.forEach((inp) => {
    const key = nameKey(inp.value);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  });

  const dupes = [];
  inputs.forEach((inp) => {
    const value = inp.value.trim();
    const isDupe = value !== "" && counts.get(nameKey(value)) > 1;
    inp.classList.toggle("dupe", isDupe);
    if (isDupe && !dupes.some((n) => nameKey(n) === nameKey(value))) dupes.push(value);
  });

  const taken = new Set(inputs.map((inp) => nameKey(inp.value)).filter(Boolean));
  $$("#recent-names .name-tile").forEach((tile) => {
    const used = taken.has(nameKey(tile.dataset.name));
    tile.classList.toggle("used", used);
    tile.querySelector(".tile-name").disabled = used;
  });

  if (dupes.length === 0) {
    $("#player-warning").classList.add("hidden");
    return true;
  }
  showPlayerWarning(
    dupes.length === 1
      ? `Two players are named "${dupes[0]}" — give them different names.`
      : `These names are used more than once: ${dupes.join(", ")}.`
  );
  return false;
}

renderRecentNames();

// --- Setup screen ---

$$("#mode-toggle .toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$("#mode-toggle .toggle").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    game.mode = btn.dataset.mode;
    $("#target-label").textContent =
      game.mode === "score" ? "Target score" : "Number of rounds";
    $("#target").value = game.mode === "score" ? 100 : 6;
  });
});

$$("#direction-toggle .toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$("#direction-toggle .toggle").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    game.highWins = btn.dataset.direction === "high";
  });
});

// --- Player list with auto-spawn ---

function appendPlayerRow(value) {
  const count = $$("#player-list .player-row").length + 1;
  const row = document.createElement("div");
  row.className = "player-row";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "player-name";
  input.placeholder = `Player ${count}`;
  if (value) input.value = value;

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-player";
  removeBtn.type = "button";
  removeBtn.setAttribute("aria-label", "Remove");
  removeBtn.textContent = "\u00d7";

  row.appendChild(input);
  row.appendChild(removeBtn);
  $("#player-list").appendChild(row);
  return input;
}

// Swoop uses one 54-card pack (52 + 2 jokers) per 2 players, rounded up:
// 3-4 players -> 2 decks, 5-6 -> 3 decks, 7-8 -> 4 decks, and so on.
function decksNeeded(playerCount) {
  return Math.floor((playerCount - 1) / 2) + 1;
}

// Counts player slots, not filled names, so the hint is useful before anyone
// has typed anything — set up N seats, then fill in who's sitting in them.
function updateDeckInfo() {
  const seats = $$("#player-list .player-row").length;
  const decks = decksNeeded(seats);
  $("#deck-info").textContent =
    `${decks} deck${decks === 1 ? "" : "s"} of cards needed for ${seats} players`;
}

$("#add-player").addEventListener("click", () => {
  appendPlayerRow().focus();
  updateDeckInfo();
  refreshPlayerState();
});

$("#player-list").addEventListener("input", (e) => {
  if (!e.target.classList.contains("player-name")) return;
  refreshPlayerState();
});

$("#player-list").addEventListener("click", (e) => {
  if (!e.target.classList.contains("remove-player")) return;
  const rows = $$("#player-list .player-row");
  if (rows.length <= 2) return;
  e.target.closest(".player-row").remove();
  $$("#player-list .player-name").forEach((inp, i) => {
    inp.placeholder = `Player ${i + 1}`;
  });
  updateDeckInfo();
  refreshPlayerState();
});

updateDeckInfo();

// Start game
$("#start-game").addEventListener("click", () => {
  const allInputs = [...$$(".player-name")];
  if (allInputs.length < 2) return;
  if (!refreshPlayerState()) {
    const firstDupe = $(".player-name.dupe");
    if (firstDupe) firstDupe.focus();
    return;
  }

  const names = allInputs.map((inp, i) => inp.value.trim() || `Player ${i + 1}`);
  // A typed name can still collide with an unnamed seat's "Player N" fallback.
  if (new Set(names.map(nameKey)).size !== names.length) {
    showPlayerWarning("Two seats would end up with the same name — rename one.");
    return;
  }

  game.target = parseInt($("#target").value) || (game.mode === "rounds" ? 6 : 100);
  game.players = names;
  game.rounds = [];

  const realNames = names.filter((n) => !n.match(/^Player \d+$/));
  if (realNames.length > 0) saveRecentNames(realNames);

  showScoring();
  saveGame();
});

// --- Scoring screen ---

function newRound() {
  return new Array(game.players.length).fill(null);
}

function updateGameInfo() {
  const modeLabel = game.mode === "score"
    ? `First to ${game.target}`
    : `${game.target} rounds`;
  const dirLabel = game.highWins ? "high wins" : "low wins";
  $("#game-info").textContent = `${modeLabel} \u00b7 ${dirLabel}`;
}

function showScoring() {
  $("#setup").classList.remove("active");
  $("#scoring").classList.add("active");

  updateGameInfo();

  buildHead();

  if (game.mode === "rounds") {
    for (let r = 0; r < game.target; r++) game.rounds.push(newRound());
  } else {
    game.rounds.push(newRound());
  }

  undoStack = [];
  lastEditKey = null;
  renderGrid();
}

function buildHead() {
  const headRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.textContent = "";
  headRow.appendChild(corner);

  game.players.forEach((name) => {
    const th = document.createElement("th");
    th.textContent = name;
    headRow.appendChild(th);
  });

  $("#grid-head").replaceChildren(headRow);
}

function renderGrid(focusRound = null) {
  const body = $("#grid-body");
  body.replaceChildren();

  game.rounds.forEach((roundScores, r) => {
    const tr = document.createElement("tr");

    const label = document.createElement("td");
    label.textContent = `R${r + 1}`;
    tr.appendChild(label);

    roundScores.forEach((val, p) => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.type = "number";
      input.dataset.round = r;
      input.dataset.player = p;

      if (val === null) {
        input.value = "";
        input.classList.add("untouched");
      } else {
        input.value = val;
      }

      input.addEventListener("input", onScoreInput);
      input.addEventListener("focus", () => {
        lastEditKey = null;
        input.select();
      });
      td.appendChild(input);
      tr.appendChild(td);
    });

    body.appendChild(tr);
  });

  updateTotals();
  refreshToolButtons();

  if (focusRound === null) return;
  const target = body.querySelector(`input[data-round="${focusRound}"][data-player="0"]`);
  if (target) target.select();
}

function onScoreInput(e) {
  const input = e.target;
  const r = parseInt(input.dataset.round);
  const p = parseInt(input.dataset.player);
  bankEdit(`${r},${p}`, snapshot());

  const raw = input.value.trim();
  // A number input reports "" for unparseable text, so ask it directly rather
  // than silently storing a 0 for something the player never typed.
  const bad = input.validity && input.validity.badInput;
  const n = raw === "" ? null : Number(raw);

  if (bad || (raw !== "" && !Number.isFinite(n))) {
    input.classList.add("invalid");
    input.classList.remove("untouched");
    game.rounds[r][p] = null;
  } else if (raw === "") {
    // Cleared the input (or mid-typing a lone "-") — back to untouched
    input.classList.remove("invalid");
    input.classList.add("untouched");
    game.rounds[r][p] = null;
  } else {
    input.classList.remove("invalid", "untouched");
    game.rounds[r][p] = n;
  }

  updateTotals();
  refreshToolButtons();
  saveGame();
}

// Treat null as 0 for summing
function cellValue(v) {
  return v === null ? 0 : v;
}

function updateTotals() {
  const foot = $("#grid-foot");
  const tr = document.createElement("tr");

  const label = document.createElement("td");
  label.textContent = "Total";
  tr.appendChild(label);

  const totals = game.players.map((_, p) =>
    game.rounds.reduce((sum, round) => sum + cellValue(round[p]), 0)
  );

  // A round is incomplete if it has a mix of entered and untouched cells
  const incomplete = game.rounds.some((round) => {
    const enteredCount = round.filter((v) => v !== null).length;
    return enteredCount > 0 && enteredCount < round.length;
  });

  const anyEntered = game.rounds.some((round) => round.some((v) => v !== null));
  const allEntered = game.rounds.length > 0 &&
    game.rounds.every((round) => round.every((v) => v !== null));
  const badCells = $$("#grid-body input.invalid").length;
  const bestTotal = game.highWins ? Math.max(...totals) : Math.min(...totals);

  totals.forEach((total) => {
    const td = document.createElement("td");
    td.textContent = total;
    if (!incomplete && anyEntered && total === bestTotal) td.className = "leader";
    tr.appendChild(td);
  });

  foot.replaceChildren(tr);

  const status = $("#score-status");
  if (badCells > 0) {
    status.textContent = badCells === 1
      ? "A score isn't a valid number — that cell is not being counted."
      : `${badCells} scores aren't valid numbers — those cells are not being counted.`;
    status.classList.remove("hidden");
    hideGameOver();
  } else if (incomplete) {
    status.textContent = "Finish entering scores for all players before results are final.";
    status.classList.remove("hidden");
    hideGameOver();
  } else {
    status.classList.add("hidden");

    const shouldEnd = game.mode === "score"
      ? anyEntered && totals.some((t) => t >= game.target)
      : allEntered;

    if (shouldEnd) {
      showGameOver();
    } else {
      hideGameOver();
    }
  }
}

function addRound() {
  pushUndo();
  lastEditKey = null;
  game.rounds.push(newRound());
  // In rounds mode the target IS the round count, so keep the header honest.
  if (game.mode === "rounds") game.target = game.rounds.length;
  updateGameInfo();
  renderGrid(game.rounds.length - 1);
  saveGame();
}

$("#add-round").addEventListener("click", addRound);

$("#remove-round").addEventListener("click", () => {
  if (game.rounds.length <= 1) return;
  const last = game.rounds[game.rounds.length - 1];
  if (last.some((v) => v !== null) &&
      !confirm(`Remove round ${game.rounds.length}? Its scores will be deleted.`)) return;

  pushUndo();
  lastEditKey = null;
  game.rounds.pop();
  if (game.mode === "rounds") game.target = game.rounds.length;
  updateGameInfo();
  renderGrid();
  saveGame();
});

$("#undo").addEventListener("click", undo);

// Clear all scores
$("#clear-all").addEventListener("click", () => {
  if (!confirm("This will erase ALL scores. Are you sure?")) return;
  pushUndo();
  lastEditKey = null;
  game.rounds = game.rounds.map((r) => r.map(() => null));
  renderGrid();
  saveGame();
});

function listNames(names) {
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function showGameOver() {
  const { idxs, score } = findWinners();
  const names = idxs.map((i) => game.players[i]);
  const pts = `${score} point${Math.abs(score) === 1 ? "" : "s"}`;
  const tie = idxs.length > 1;

  $("#winner-text").textContent = tie
    ? `It's a tie! ${listNames(names)} are tied at ${pts}.`
    : `${names[0]} wins with ${pts}!`;

  $("#bonus-round").classList.toggle("hidden", !tie);
  $("#new-game").classList.toggle("secondary", tie);
  $("#game-over").classList.remove("hidden");
}

function hideGameOver() {
  $("#game-over").classList.add("hidden");
}

// Every player sharing the best total — ties are real and must be shown.
function findWinners() {
  const totals = game.players.map((_, p) =>
    game.rounds.reduce((sum, round) => sum + cellValue(round[p]), 0)
  );
  const best = game.highWins ? Math.max(...totals) : Math.min(...totals);
  const idxs = totals.reduce((acc, t, i) => (t === best ? [...acc, i] : acc), []);
  return { idxs, score: best };
}

$("#bonus-round").addEventListener("click", () => {
  hideGameOver();
  addRound();
});

function resetToSetup() {
  $("#scoring").classList.remove("active");
  $("#setup").classList.add("active");
  $("#game-over").classList.add("hidden");
  $("#grid-body").replaceChildren();
  $("#grid-foot").replaceChildren();
  renderRecentNames();
  undoStack = [];
  lastEditKey = null;
  clearSavedGame();
}

$("#new-game").addEventListener("click", resetToSetup);

$("#back-btn").addEventListener("click", () => {
  if (confirm("End this game and go back to setup?")) resetToSetup();
});

// --- Restore an in-progress game after a reload / discarded tab ---

function restoreGame() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(GAME_KEY));
  } catch { return; }

  // Only restore something that looks like a real, playable game.
  if (!saved || !Array.isArray(saved.players) || saved.players.length < 2 ||
      !Array.isArray(saved.rounds) || saved.rounds.length === 0) return;

  game = saved;

  $("#setup").classList.remove("active");
  $("#scoring").classList.add("active");

  undoStack = [];
  lastEditKey = null;
  updateGameInfo();
  buildHead();
  renderGrid();
}

// --- Color + text themes (localStorage) ---
// Keep in sync with the [data-theme] / [data-font] blocks in style.css.
// "ember" and "rounded" are the pair whose tokens live in :root, so their
// attribute values match no rule — harmless, and it keeps the attributes set.

const THEME_KEY = "swoopscore_theme";
const DEFAULT_THEME = "paper";

const THEME_GROUPS = [
  { group: "Light", themes: [
    { id: "paper",  label: "Paper",  bg: "#fffdf9", accent: "#c2593c" },
    { id: "mist",   label: "Mist",   bg: "#ffffff", accent: "#2f8f88" },
    { id: "bloom",  label: "Bloom",  bg: "#fffcfd", accent: "#a4568c" },
    { id: "linen",  label: "Linen",  bg: "#f7f5f1", accent: "#4c6b52" },
    { id: "stone",  label: "Stone",  bg: "#eaeae8", accent: "#3f5d78" },
    { id: "solar",  label: "Solar",  bg: "#fffbf0", accent: "#1f7fa8" },
  ] },
  { group: "Dark", themes: [
    { id: "ember",    label: "Ember",    bg: "#252238", accent: "#e07a5f" },
    { id: "dusk",     label: "Dusk",     bg: "#1b2c38", accent: "#4db6ac" },
    { id: "mono",     label: "Slate",    bg: "#23272b", accent: "#d9b26a" },
    { id: "midnight", label: "Midnight", bg: "#1a2237", accent: "#8b9dfa" },
    { id: "moss",     label: "Moss",     bg: "#1d2c22", accent: "#8fc48c" },
    { id: "cocoa",    label: "Cocoa",    bg: "#2c221d", accent: "#d99a5b" },
  ] },
  { group: "Funky", themes: [
    { id: "neon",      label: "Neon",      bg: "#1a1230", accent: "#ff2fb9" },
    { id: "vapor",     label: "Vapor",     bg: "#fdf8ff", accent: "#00a3a3" },
    { id: "terminal",  label: "Terminal",  bg: "#0b1a0e", accent: "#39ff88" },
    { id: "bubblegum", label: "Bubblegum", bg: "#fffafc", accent: "#e0407f" },
  ] },
];

const THEMES = THEME_GROUPS.flatMap((g) => g.themes);

const FONT_KEY = "swoopscore_font";
const DEFAULT_FONT = "rounded";

// `sample` mirrors the title family/weight/scale from the [data-font] block so
// each row in the menu is set in the font it selects.
const FONT_THEMES = [
  { id: "rounded",  label: "Rounded",  sample: ['"Quicksand", sans-serif', 700, 1] },
  { id: "robot",    label: "Robot",    sample: ['"Audiowide", sans-serif', 400, 0.91] },
  { id: "sport",    label: "Sport",    sample: ['"Bungee", sans-serif', 400, 0.91] },
  { id: "classic",  label: "Classic",  sample: ['"Abril Fatface", serif', 400, 1] },
  { id: "terminal", label: "Terminal", sample: ['"VT323", monospace', 400, 1.25] },
];

function savedChoice(key, list, fallback) {
  try {
    const id = localStorage.getItem(key);
    return list.some((t) => t.id === id) ? id : fallback;
  } catch { return fallback; }
}

function persist(key, id, what) {
  try {
    localStorage.setItem(key, id);
  } catch (e) {
    // Fail loud: it is applied but won't come back next visit.
    console.warn(`SwoopScore: could not save ${what} — it will reset on reload.`, e);
  }
}

function applyChoice(attr, popoverId, dataKey, id) {
  document.documentElement.setAttribute(attr, id);
  $$(`#${popoverId} .picker-option`).forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset[dataKey] === id));
  });
}

const applyTheme = (id) => applyChoice("data-theme", "theme-popover", "theme", id);
const applyFont  = (id) => applyChoice("data-font", "font-popover", "font", id);

function setTheme(id) { applyTheme(id); persist(THEME_KEY, id, "theme"); }
function setFont(id)  { applyFont(id);  persist(FONT_KEY, id, "text theme"); }

function closeMenus(except) {
  $$(".picker-popover").forEach((pop) => {
    if (pop === except) return;
    pop.classList.add("hidden");
    pop.previousElementSibling.setAttribute("aria-expanded", "false");
  });
}

function pickerOption(dataKey, id, label, decorate, onPick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "picker-option";
  b.dataset[dataKey] = id;
  b.setAttribute("role", "menuitemradio");
  decorate(b, label);
  b.addEventListener("click", () => {
    onPick(id);
    closeMenus();
  });
  return b;
}

function themeOption(t) {
  return pickerOption("theme", t.id, t.label, (b, label) => {
    b.style.setProperty("--dot-accent", t.accent);
    b.style.setProperty("--dot-bg", t.bg);
    const dot = document.createElement("span");
    dot.className = "picker-dot";
    b.append(dot, label);
  }, setTheme);
}

function fontOption(f) {
  return pickerOption("font", f.id, f.label, (b, label) => {
    const [family, weight, scale] = f.sample;
    b.style.setProperty("--opt-font", family);
    b.style.setProperty("--opt-weight", weight);
    b.style.setProperty("--opt-scale", scale);
    const sample = document.createElement("span");
    sample.className = "opt-sample";
    sample.textContent = label;
    b.append(sample);
  }, setFont);
}

function wireTrigger(triggerId, popoverId) {
  const trigger = $(`#${triggerId}`);
  const pop = $(`#${popoverId}`);
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = pop.classList.toggle("hidden") === false;
    closeMenus(pop);
    trigger.setAttribute("aria-expanded", String(open));
    if (open) pop.scrollTop = 0;
  });
}

function buildMenus() {
  const themeNodes = [];
  for (const { group, themes } of THEME_GROUPS) {
    const h = document.createElement("div");
    h.className = "picker-group";
    h.textContent = group;
    themeNodes.push(h, ...themes.map(themeOption));
  }
  $("#theme-popover").replaceChildren(...themeNodes);
  $("#font-popover").replaceChildren(...FONT_THEMES.map(fontOption));

  wireTrigger("theme-trigger", "theme-popover");
  wireTrigger("font-trigger", "font-popover");

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".picker")) closeMenus();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenus();
  });

  applyTheme(savedChoice(THEME_KEY, THEMES, DEFAULT_THEME));
  applyFont(savedChoice(FONT_KEY, FONT_THEMES, DEFAULT_FONT));
}

buildMenus();

restoreGame();

// --- Birthday splash ---
// Keyed by local "MM-DD". Shown on every page load that day (starting a new
// game doesn't reload, so it won't interrupt play). To preview on any day, add
// "#birthday" (the next one coming up, counting today), "#birthday-tone" (a
// named one) or "#birthday-tone-3" (one of that person's numbered variants)
// to the URL.

const BIRTHDAYS = {
  "10-03": { name: "Danielle", show: danielleSplash },
  "10-25": { name: "Tone", show: toneSplash },
};
const BDAY_EMOJI = ["🎉", "🥳", "🎂", "🎈", "🦄", "🍰", "🤪", "🎁"];
const BDAY_COLORS = ["var(--accent)", "#d9822b", "#2f8f88", "#a4568c", "#4f6fc4"];

const bdayEl = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

function showBirthday() {
  const now = new Date();
  const today = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const preview = location.hash.match(/^#birthday(?:-([a-z]+))?(?:-(\d+))?$/i);
  const all = Object.values(BIRTHDAYS);
  const bday = !preview ? BIRTHDAYS[today]
    : preview[1] ? all.find((b) => b.name.toLowerCase() === preview[1].toLowerCase()) : BIRTHDAYS[nextBirthday(now)];
  if (preview && !bday) console.warn(`No birthday named "${preview[1]}" to preview`);
  if (!bday) return;

  const splash = bdayEl("div", "bday");
  splash.setAttribute("role", "dialog");
  splash.setAttribute("aria-label", `Happy birthday, ${bday.name}!`);
  splash.addEventListener("click", () => {
    splash.classList.add("out");
    setTimeout(() => splash.remove(), 400);
  });
  document.body.append(splash);
  bday.show(splash, bday.name, preview && Number(preview[2]));
}

// The "MM-DD" key of the soonest birthday on or after `now`, wrapping into next year.
function nextBirthday(now) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysUntil = (key) => {
    const [m, d] = key.split("-").map(Number);
    let date = new Date(now.getFullYear(), m - 1, d);
    if (date < midnight) date = new Date(now.getFullYear() + 1, m - 1, d);
    return date - midnight;
  };
  return Object.keys(BIRTHDAYS).reduce((a, b) => (daysUntil(b) < daysUntil(a) ? b : a));
}

function danielleSplash(splash, name) {
  const orbit = bdayEl("div", "bday-orbit");
  BDAY_EMOJI.forEach((emoji, i) => {
    const a = (i / BDAY_EMOJI.length) * 2 * Math.PI;
    const r = Math.min(135, window.innerWidth / 2 - 30);
    const span = bdayEl("span");
    span.style.transform = `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r}px)`;
    span.append(bdayEl("b", null, emoji));
    orbit.append(span);
  });

  const title = bdayEl("h2", "bday-name");
  [...name].forEach((ch, i) => {
    const s = bdayEl("span", null, ch);
    s.style.animationDelay = `${0.25 + i * 0.08}s`;
    s.style.color = BDAY_COLORS[i % BDAY_COLORS.length];
    title.append(s);
  });

  const msg = bdayEl("div", "bday-msg");
  msg.append(bdayEl("div", "bday-hb", "Happy birthday"), title,
    bdayEl("p", "bday-rule", "Birthday rule: you go first."), bdayEl("div", "bday-tap", "Tap to play"));
  splash.append(orbit, msg);
  confetti(splash);
}

// Tone's splash: one of five lead-ins, picked at random on each load, flings
// his four cut-out heads around and ends on the same explosion + "HBD TONE!".

const TONE_EMOJI = ["🎉", "🥳", "🎂", "🎈", "🎁", "💥", "🎊", "🤘"];
const TONE_SPLASHES = [bounceHouse, popUpParty, toneTornado, rocketLaunch, bigHeadMode];

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeIn = (t) => t * t * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

async function toneSplash(splash, name, variant) {
  if (variant && !TONE_SPLASHES[variant - 1]) console.warn(`No Tone splash #${variant}; picking one at random`);
  const play = TONE_SPLASHES[variant - 1] || pick(TONE_SPLASHES);
  splash.classList.add("tone");
  const heads = [1, 2, 3, 4].map((i) => {
    const img = bdayEl("img", "tone-head");
    img.src = `img/tone-${i}.webp?v=1`;
    img.alt = "";
    return img;
  });
  const st = new HeadStage(splash, heads, name);
  try {
    await Promise.all(heads.map((h) => h.decode()));
  } catch (e) {
    console.error("Tone's head images failed to load", e);
    st.finale("(his photos didn't load)");
    return;
  }
  play(st);
}

// Everything is positioned from JS: heads by transform (via place()), bits of
// confetti and sparks on one canvas. Loops end once the splash is dismissed.
class HeadStage {
  constructor(splash, heads, name) {
    Object.assign(this, { splash, heads, name, parts: [] });
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.cx = this.W / 2; this.cy = this.H / 2;
    this.hw = Math.round(Math.min(this.W, this.H * 0.6) * 0.3);
    splash.style.setProperty("--hw", `${this.hw}px`);
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    this.colors = [...BDAY_COLORS.map((c) => (c.startsWith("var(") ? accent : c)), "#e3b23c"];
    this.canvas = bdayEl("canvas", "tone-canvas");
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.W * this.dpr; this.canvas.height = this.H * this.dpr;
    this.ctx = this.canvas.getContext("2d");
    splash.append(this.canvas, ...heads);
    this.loop();
  }
  // Calls fn(seconds) every frame until it returns false; resolves then.
  frames(fn) {
    return new Promise((done) => {
      const t0 = performance.now();
      const step = (now) => {
        if (!this.splash.isConnected) return;
        if (fn((now - t0) / 1000) === false) done(); else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }
  place(img, x, y, rot = 0, sx = 1, sy = sx, op = 1) {
    const h = (this.hw * img.naturalHeight) / img.naturalWidth;
    img.style.transform = `translate(${x - this.hw / 2}px, ${y - h / 2}px) rotate(${rot}deg) scale(${sx}, ${sy})`;
    img.style.opacity = op;
  }
  // "bit" = paper confetti that falls, "spark" = a short glowing streak.
  burst(x, y, n = 60, { speed = 7, colors = this.colors, kind = "bit", up = 2, life = 1.6 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, 2 * Math.PI), v = rnd(0.3, 1) * speed;
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - up, r: rnd(0, 6), vr: rnd(-0.3, 0.3),
        s: rnd(4, 8), c: pick(colors), kind, age: 0, life: life * rnd(0.7, 1.2) });
    }
  }
  loop() {
    const { ctx, dpr } = this;
    const tick = () => {
      if (!this.splash.isConnected) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
      this.parts = this.parts.filter((p) => (p.age += 1 / 60) < p.life);
      for (const p of this.parts) {
        ctx.globalAlpha = Math.min(1, (1 - p.age / p.life) * 3);
        if (p.kind === "spark") {
          p.vx *= 0.94; p.vy = p.vy * 0.94 + 0.08; p.x += p.vx; p.y += p.vy;
          ctx.strokeStyle = p.c; ctx.lineWidth = 2.5; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3); ctx.stroke();
        } else {
          p.vx *= 0.97; p.vy = p.vy * 0.97 + 0.22; p.x += p.vx; p.y += p.vy; p.r += p.vr;
          ctx.save();
          ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.scale(1, Math.cos(p.r * 3));
          ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
          ctx.restore();
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  fx(cls, keyframes, ms, x, y) {
    const d = bdayEl("div", cls);
    d.style.left = `${x}px`; d.style.top = `${y}px`;
    this.splash.append(d);
    d.animate(keyframes, { duration: ms, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" }).onfinish = () => d.remove();
  }
  explode(x = this.cx, y = this.cy, big = true) {
    this.fx("tone-flash", [{ transform: "scale(.2)", opacity: 1 }, { transform: `scale(${big ? 14 : 5})`, opacity: 0 }], big ? 700 : 450, x, y);
    this.fx("tone-ring", [{ transform: "scale(.2)", opacity: 1 }, { transform: `scale(${big ? 12 : 4})`, opacity: 0, borderWidth: "1px" }], big ? 800 : 500, x, y);
    this.burst(x, y, big ? 110 : 30, { speed: big ? 12 : 6 });
    this.burst(x, y, big ? 60 : 20, { speed: big ? 14 : 8, kind: "spark", colors: ["#fff3b0", "#ffd166", "#ff8c42", "#ff5e5b"], up: 0, life: 0.9 });
  }
  // The shared ending: blast, shake, emoji spray into a bobbing ring, title slam.
  finale(note) {
    const { splash } = this;
    this.explode();
    splash.animate([{ transform: "translate(6px,-4px)" }, { transform: "translate(-5px,5px)" }, { transform: "translate(4px,3px)" }, { transform: "none" }], { duration: 300 });
    const R = Math.min(this.W, this.H) * 0.42;
    TONE_EMOJI.forEach((e, i) => {
      const s = bdayEl("span", "tone-emo", e);
      splash.append(s);
      const a = (i / TONE_EMOJI.length) * 2 * Math.PI - Math.PI / 2;
      const x = Math.cos(a) * R, y = Math.sin(a) * R * 1.35;
      s.animate([
        { transform: "translate(0,0) scale(.2) rotate(-200deg)", opacity: 0 },
        { offset: 0.7, transform: `translate(${x * 1.15}px,${y * 1.15}px) scale(1.5) rotate(20deg)`, opacity: 1 },
        { transform: `translate(${x}px,${y}px) scale(1) rotate(0)`, opacity: 1 },
      ], { duration: 900, delay: i * 30, easing: "cubic-bezier(.2,.8,.3,1)", fill: "forwards" }).onfinish = () =>
        s.animate([{ transform: `translate(${x}px,${y}px)` }, { transform: `translate(${x}px,${y - 8}px) rotate(${i % 2 ? 12 : -12}deg)` }],
          { duration: 700 + i * 60, direction: "alternate", iterations: Infinity, easing: "ease-in-out", fill: "forwards" });
    });
    const word = (cls, text, delay, shift) => {
      const w = bdayEl("div", cls);
      [...text].forEach((ch, i) => {
        const s = bdayEl("span", null, ch);
        s.style.color = this.colors[(i + shift) % this.colors.length];
        s.animate([
          { transform: "scale(4) rotate(-30deg)", opacity: 0 },
          { offset: 0.6, transform: "scale(.85) rotate(4deg)", opacity: 1 },
          { transform: "none", opacity: 1 },
        ], { duration: 450, delay: delay + i * 70, easing: "cubic-bezier(.3,1.5,.5,1)", fill: "backwards" });
        w.append(s);
      });
      return w;
    };
    const msg = bdayEl("div", "tone-msg");
    msg.append(word("tone-hbd", "HBD", 0, 0), word("tone-name", `${this.name.toUpperCase()}!`, 260, 2),
      bdayEl("p", "bday-rule", "Birthday rule: you go first."), bdayEl("div", "bday-tap", "Tap to play"));
    if (note) msg.append(bdayEl("p", "bday-tap", note));
    splash.append(msg);
    setTimeout(() => this.burst(this.cx, this.H * 0.3, 50, { speed: 9 }), 600);
  }
  // After the finale, the heads glide from `from` ([x, y, rot, scale] each)
  // to the four corners and bob there.
  async parkHeads(from) {
    const spots = [[0.22, 0.14], [0.78, 0.14], [0.22, 0.86], [0.78, 0.86]].map(([x, y]) => [x * this.W, y * this.H]);
    await this.frames((t) => {
      const k = easeOut(Math.min(1, t / 0.7));
      this.heads.forEach((h, i) => {
        const [fx, fy, fr, fs] = from[i], [tx, ty] = spots[i];
        this.place(h, fx + (tx - fx) * k, fy + (ty - fy) * k, fr * (1 - k) + (i % 2 ? 8 : -8) * k, fs + (0.8 - fs) * k);
      });
      return t < 0.7;
    });
    this.frames((t) => {
      this.heads.forEach((h, i) => {
        const [x, y] = spots[i];
        this.place(h, x, y - Math.abs(Math.sin(t * 3 + i)) * 10, Math.sin(t * 2 + i) * 9, 0.8);
      });
    });
  }
}

// Heads drop in and ricochet off the walls, squashing on each landing, then
// get pulled together and smash into the title.
async function bounceHouse(st) {
  const half = st.hw / 2;
  const s = st.heads.map((h, i) => ({ x: rnd(st.hw, st.W - st.hw), y: -st.hw - i * 140, vx: pick([-1, 1]) * rnd(2, 6), vy: 0, rot: 0, sq: 0 }));
  await st.frames((t) => {
    s.forEach((b, i) => {
      if (t < i * 0.35) return;
      b.vy += 0.55; b.x += b.vx; b.y += b.vy; b.rot += b.vx * 2; b.sq *= 0.85;
      if (b.y > st.H - half) {
        b.y = st.H - half; b.vy = -Math.max(Math.abs(b.vy) * 0.9, 13); b.sq = 0.35;
        st.burst(b.x, st.H - 4, 6, { speed: 4, up: 3 });
      }
      if (b.x < half || b.x > st.W - half) { b.vx *= -1; b.x = Math.min(Math.max(b.x, half), st.W - half); }
      st.place(st.heads[i], b.x, b.y, b.rot, 1 + b.sq, 1 - b.sq);
    });
    return t < 3.4;
  });
  await st.frames((t) => {
    const k = easeIn(Math.min(1, t / 0.6));
    s.forEach((b, i) => st.place(st.heads[i], b.x + (st.cx - b.x) * k, b.y + (st.cy - b.y) * k, b.rot + 720 * k, 1 - 0.5 * k));
    return t < 0.6;
  });
  st.finale();
  st.parkHeads(st.heads.map(() => [st.cx, st.cy, 0, 0.5]));
}

// Whack-a-mole: heads pop in and out, faster and faster, until all four pop
// up in a row.
async function popUpParty(st) {
  const pop = (h, x, y, ms) => {
    const tilt = rnd(-25, 25);
    const at = `translate(${x - st.hw / 2}px,${y - (st.hw * h.naturalHeight) / h.naturalWidth / 2}px)`;
    h.style.opacity = 1;
    h.animate([
      { transform: `${at} scale(0) rotate(${tilt}deg)` },
      { offset: 0.25, transform: `${at} scale(1.25) rotate(${-tilt / 2}deg)` },
      { offset: 0.4, transform: `${at} scale(.95) rotate(${tilt / 4}deg)` },
      { offset: 0.85, transform: `${at} scale(1)` },
      { transform: `${at} scale(0) rotate(${-tilt}deg)` },
    ], { duration: ms, easing: "ease-out", fill: "forwards" });
    setTimeout(() => st.burst(x, y, 14, { speed: 5, up: 1 }), ms * 0.9);
  };
  let gap = 520;
  for (let n = 0; n < 12; n++) {
    const x = rnd(st.hw * 0.7, st.W - st.hw * 0.7), y = rnd(st.hw * 0.8, st.H - st.hw * 0.8);
    pop(st.heads[n % 4], x, y, Math.max(gap * 1.6, 380));
    if (n > 7) pop(st.heads[(n + 2) % 4], st.W - x, st.H - y, 380);
    await sleep(gap);
    gap *= 0.84;
  }
  const row = st.heads.map((h, i) => [st.W * (0.14 + i * 0.24), st.cy]);
  st.heads.forEach((h, i) => pop(h, row[i][0], row[i][1], 700));
  await sleep(650);
  st.heads.forEach((h) => h.getAnimations().forEach((a) => a.cancel()));
  st.finale();
  st.parkHeads(row.map(([x, y]) => [x, y, 0, 0]));
}

// The heads whirl in a tightening spiral, collapse into the middle and blow
// up, then orbit the title.
async function toneTornado(st) {
  const R0 = Math.max(st.W, st.H) * 0.7;
  await st.frames((t) => {
    const k = Math.min(1, t / 3.2);
    const rad = R0 * (1 - easeInOut(k)) + 4, ang = 8 * k * k * 2 * Math.PI;
    st.heads.forEach((h, i) => {
      const a = ang + (i * Math.PI) / 2;
      st.place(h, st.cx + Math.cos(a) * rad, st.cy + Math.sin(a) * rad * 1.3, ang * 57 * (i % 2 ? -1 : 1), 1.1 - 0.6 * k);
    });
    if (k > 0.3 && Math.random() < 0.3) {
      st.burst(st.cx + rnd(-120, 120) * (1 - k), st.cy + rnd(-120, 120) * (1 - k), 2, { speed: 3, kind: "spark", up: 0, life: 0.5 });
    }
    return t < 3.2;
  });
  st.finale();
  const R = st.W * 0.36;
  st.frames((t) => {
    const k = easeOut(Math.min(1, t / 0.8));
    st.heads.forEach((h, i) => {
      const a = t * 0.9 + (i * Math.PI) / 2;
      st.place(h, st.cx + Math.cos(a) * R * k * 1.05, st.cy + Math.sin(a) * R * k * 2, Math.sin(t * 2 + i) * 12, 0.5 + 0.2 * k, undefined, 0.95);
    });
  });
}

// Each head blasts off from the bottom and bursts into a firework; then all
// four launch together.
async function rocketLaunch(st) {
  const flame = ["#ffd166", "#ff8c42", "#fff3b0"];
  const launch = (h, x, apexY, dur, color) => st.frames((t) => {
    const k = Math.min(1, t / dur);
    const y = st.H + st.hw - (st.H + st.hw - apexY) * easeOut(k);
    st.place(h, x + Math.sin(k * 12) * 6, y, k * 540, 0.7 + 0.3 * k);
    if (k < 0.9) st.burst(x, y + st.hw * 0.45, 2, { speed: 2, kind: "spark", colors: flame, up: -2, life: 0.5 });
    if (k >= 1) {
      st.explode(x, apexY, false);
      st.burst(x, apexY, 45, { speed: 9, kind: "spark", colors: [color, "#fff3b0"], up: 0, life: 1.1 });
    }
    return k < 1;
  });
  const xs = [0.3, 0.7, 0.45, 0.62];
  for (let i = 0; i < 4; i++) {
    const h = st.heads[i], x = xs[i] * st.W, y = st.H * rnd(0.22, 0.4);
    await launch(h, x, y, 0.75, st.colors[i + 1]);
    st.frames((t) => { st.place(h, x + t * 40 * (i % 2 ? 1 : -1), y + t * t * 500, 540 + t * 400, 1, 1, Math.max(0, 1 - t)); return t < 1; });
    await sleep(250);
  }
  await Promise.all(st.heads.map((h, i) => st.frames((t) => {
    const k = Math.min(1, t / 0.8), x0 = st.W * (0.12 + i * 0.25);
    const x = x0 + (st.cx - x0) * easeIn(k), y = st.H + st.hw - (st.H + st.hw - st.cy) * easeOut(k);
    st.place(h, x, y, k * 720, 0.9 - 0.4 * k);
    st.burst(x, y + 20, 1, { speed: 2, kind: "spark", colors: flame, up: -2, life: 0.4 });
    return k < 1;
  })));
  st.finale();
  st.parkHeads(st.heads.map(() => [st.cx, st.cy, 0, 0.5]));
}

// A hype reel: each head zooms at the camera over a color slam, then all four
// shrink back into a stack and blast apart.
async function bigHeadMode(st) {
  for (let i = 0; i < 4; i++) {
    const h = st.heads[i];
    const slam = bdayEl("div", "tone-slam");
    slam.style.background = st.colors[i];
    st.splash.append(slam);
    slam.animate([{ opacity: 0 }, { opacity: 0.9, offset: 0.15 }, { opacity: 0.9, offset: 0.8 }, { opacity: 0 }], { duration: 700, fill: "forwards" });
    const spin = i % 2 ? 1 : -1;
    await st.frames((t) => {
      const k = Math.min(1, t / 0.7);
      const s = k < 0.35 ? 0.1 + 3.4 * easeOut(k / 0.35) : 3.5 + 1.5 * (k - 0.35);
      st.place(h, st.cx, st.cy, spin * (1 - easeOut(Math.min(1, k * 3))) * 180, s, s, k < 0.8 ? 1 : 1 - (k - 0.8) * 5);
      return k < 1;
    });
    st.burst(st.cx, st.cy, 25, { speed: 10, up: 0 });
    slam.remove();
    h.style.opacity = 0;
  }
  await st.frames((t) => {
    const k = easeOut(Math.min(1, t / 0.6));
    st.heads.forEach((h, i) => st.place(h, st.cx + (i - 1.5) * 14 * k, st.cy + (i % 2 ? 8 : -8) * k, (i - 1.5) * 20 * k, 5 - 4.4 * k));
    return t < 0.6;
  });
  await sleep(150);
  st.finale();
  st.parkHeads(st.heads.map((h, i) => [st.cx + (i - 1.5) * 14, st.cy, (i - 1.5) * 20, 0.6]));
}

// One ~3 s burst of paper bits from mid-screen; the loop and canvas remove
// themselves when it's over (or when the splash is dismissed).
function confetti(host) {
  const c = document.createElement("canvas");
  c.className = "bday-confetti";
  host.append(c);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = (c.width = window.innerWidth * dpr), h = (c.height = window.innerHeight * dpr);
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  const colors = BDAY_COLORS.map((col) => (col.startsWith("var(") ? accent : col));
  const bits = Array.from({ length: 90 }, () => {
    const a = rnd(0, 2 * Math.PI), v = rnd(4, 13) * dpr;
    return { x: w / 2, y: h * 0.45, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5 * dpr, r: rnd(0, 6), vr: rnd(-0.3, 0.3),
      size: rnd(4, 8) * dpr, color: colors[Math.floor(Math.random() * colors.length)] };
  });
  const ctx = c.getContext("2d"), t0 = performance.now();
  (function tick(t) {
    const k = (t - t0) / 3000;
    if (k > 1 || !c.isConnected) return c.remove();
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = Math.min(1, (1 - k) * 3);
    for (const b of bits) {
      b.vx *= 0.97; b.vy = b.vy * 0.97 + 0.45 * dpr; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      ctx.save();
      ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.scale(1, Math.cos(b.r * 3));
      ctx.fillStyle = b.color; ctx.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2);
      ctx.restore();
    }
    requestAnimationFrame(tick);
  })(t0);
}

showBirthday();
