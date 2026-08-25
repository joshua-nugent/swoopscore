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

// --- Color themes (localStorage) ---
// Keep in sync with the [data-theme] blocks in style.css. "ember" is the one
// theme whose tokens live in :root, so its data-theme value matches no rule —
// harmless, and it keeps the attribute always set.

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

function savedTheme() {
  try {
    const id = localStorage.getItem(THEME_KEY);
    return THEMES.some((t) => t.id === id) ? id : DEFAULT_THEME;
  } catch { return DEFAULT_THEME; }
}

function applyTheme(id) {
  document.documentElement.setAttribute("data-theme", id);
  $$("#theme-popover .theme-option").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.theme === id));
  });
}

function setTheme(id) {
  applyTheme(id);
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch (e) {
    // Fail loud: the theme is applied but won't come back next visit.
    console.warn("SwoopScore: could not save theme — it will reset on reload.", e);
  }
}

function closeThemeMenu() {
  $("#theme-popover").classList.add("hidden");
  $("#theme-trigger").setAttribute("aria-expanded", "false");
}

function themeOption(t) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "theme-option";
  b.dataset.theme = t.id;
  b.setAttribute("role", "menuitemradio");
  b.style.setProperty("--dot-accent", t.accent);
  b.style.setProperty("--dot-bg", t.bg);
  const dot = document.createElement("span");
  dot.className = "theme-dot";
  b.append(dot, t.label);
  b.addEventListener("click", () => {
    setTheme(t.id);
    closeThemeMenu();
  });
  return b;
}

function buildThemeMenu() {
  const pop = $("#theme-popover");
  const nodes = [];
  for (const { group, themes } of THEME_GROUPS) {
    const h = document.createElement("div");
    h.className = "theme-group";
    h.textContent = group;
    nodes.push(h, ...themes.map(themeOption));
  }
  pop.replaceChildren(...nodes);

  $("#theme-trigger").addEventListener("click", (e) => {
    e.stopPropagation();
    const open = pop.classList.toggle("hidden") === false;
    $("#theme-trigger").setAttribute("aria-expanded", String(open));
    if (open) pop.scrollTop = 0;
  });

  document.addEventListener("click", (e) => {
    if (!pop.classList.contains("hidden") && !e.target.closest(".theme-menu")) closeThemeMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeThemeMenu();
  });

  applyTheme(savedTheme());
}

buildThemeMenu();

restoreGame();
