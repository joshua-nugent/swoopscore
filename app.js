const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Cell values: null = untouched, 0 = explicit zero, number = scored
let game = { mode: "rounds", target: 6, highWins: false, players: [], rounds: [] };

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
}

function renderRecentNames() {
  const container = $("#recent-names");
  container.replaceChildren();
  const names = getRecentNames();
  if (names.length === 0) return;

  names.forEach((name) => {
    const tile = document.createElement("div");
    tile.className = "name-tile";

    const nameBtn = document.createElement("button");
    nameBtn.className = "tile-name";
    nameBtn.type = "button";
    nameBtn.textContent = name;
    nameBtn.addEventListener("click", () => {
      addPlayerWithName(name);
      ensureEmptyRow();
      updateDeckInfo();
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "tile-remove";
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", `Remove ${name}`);
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => deleteRecentName(name));

    tile.append(nameBtn, removeBtn);
    container.appendChild(tile);
  });
}

function addPlayerWithName(name) {
  const emptyInput = [...$$(".player-name")].find((inp) => inp.value.trim() === "");
  if (emptyInput) {
    emptyInput.value = name;
    return;
  }
  appendPlayerRow(name);
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

function ensureEmptyRow() {
  const inputs = [...$$(".player-name")];
  const lastInput = inputs[inputs.length - 1];
  if (lastInput && lastInput.value.trim() !== "") {
    appendPlayerRow();
  }
}

// Swoop uses one 54-card pack (52 + 2 jokers) per 2 players, rounded up:
// 3-4 players -> 2 decks, 5-6 -> 3 decks, 7-8 -> 4 decks, and so on.
function decksNeeded(playerCount) {
  return Math.floor((playerCount - 1) / 2) + 1;
}

function updateDeckInfo() {
  const filled = [...$$(".player-name")].filter((inp) => inp.value.trim() !== "").length;
  const info = $("#deck-info");
  if (filled < 2) {
    info.textContent = "";
    return;
  }
  const decks = decksNeeded(filled);
  info.textContent = `${decks} deck${decks === 1 ? "" : "s"} of cards needed for ${filled} players`;
}

$("#player-list").addEventListener("input", (e) => {
  if (!e.target.classList.contains("player-name")) return;
  ensureEmptyRow();
  updateDeckInfo();
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
});

updateDeckInfo();

// Start game
$("#start-game").addEventListener("click", () => {
  const allInputs = [...$$(".player-name")];
  const filled = allInputs.filter((inp) => inp.value.trim() !== "");
  if (filled.length < 2) return;

  let idx = 1;
  const names = filled.map((inp) => inp.value.trim() || `Player ${idx++}`);

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
    $("#add-round").classList.add("hidden");
  } else {
    game.rounds.push(newRound());
    $("#add-round").classList.remove("hidden");
  }

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

function renderGrid(focusRound = 0) {
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
      input.addEventListener("focus", () => input.select());
      td.appendChild(input);
      tr.appendChild(td);
    });

    body.appendChild(tr);
  });

  updateTotals();

  const target = body.querySelector(`input[data-round="${focusRound}"][data-player="0"]`);
  if (target) target.select();
}

function onScoreInput(e) {
  const r = parseInt(e.target.dataset.round);
  const p = parseInt(e.target.dataset.player);
  const raw = e.target.value.trim();

  if (raw === "") {
    // Cleared the input — back to untouched
    game.rounds[r][p] = null;
    e.target.classList.add("untouched");
  } else {
    game.rounds[r][p] = parseInt(raw) || 0;
    e.target.classList.remove("untouched");
  }

  updateTotals();
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
  const bestTotal = game.highWins ? Math.max(...totals) : Math.min(...totals);

  totals.forEach((total) => {
    const td = document.createElement("td");
    td.textContent = total;
    if (!incomplete && anyEntered && total === bestTotal) td.className = "leader";
    tr.appendChild(td);
  });

  foot.replaceChildren(tr);

  const status = $("#score-status");
  if (incomplete) {
    status.textContent = "Finish entering scores for all players before results are final.";
    status.classList.remove("hidden");
    hideGameOver();
  } else {
    status.classList.add("hidden");

    const shouldEnd = game.mode === "score" && anyEntered &&
      totals.some((t) => t >= game.target);

    if (shouldEnd) {
      const w = findWinner();
      showGameOver(w.idx, w.score);
    } else {
      hideGameOver();
    }
  }
}

// Add round (score mode only)
$("#add-round").addEventListener("click", () => {
  game.rounds.push(newRound());
  renderGrid(game.rounds.length - 1);
  saveGame();
});

// Clear all scores
$("#clear-all").addEventListener("click", () => {
  if (!confirm("This will erase ALL scores. Are you sure?")) return;
  if (!confirm("Really? This cannot be undone!")) return;
  game.rounds = game.rounds.map((r) => r.map(() => null));
  renderGrid();
  saveGame();
});

function showGameOver(winnerIdx, score) {
  if (game.mode === "score") $("#add-round").classList.add("hidden");
  $("#game-over").classList.remove("hidden");
  $("#winner-text").textContent = `${game.players[winnerIdx]} wins with ${score} points!`;
}

function hideGameOver() {
  $("#game-over").classList.add("hidden");
  if (game.mode === "score") $("#add-round").classList.remove("hidden");
}

function findWinner() {
  const totals = game.players.map((_, p) =>
    game.rounds.reduce((sum, round) => sum + cellValue(round[p]), 0)
  );
  const best = game.highWins ? Math.max(...totals) : Math.min(...totals);
  const idx = totals.indexOf(best);
  return { idx, score: best };
}

function resetToSetup() {
  $("#scoring").classList.remove("active");
  $("#setup").classList.add("active");
  $("#game-over").classList.add("hidden");
  $("#add-round").classList.add("hidden");
  $("#grid-body").replaceChildren();
  $("#grid-foot").replaceChildren();
  renderRecentNames();
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
  if (game.mode === "score") $("#add-round").classList.remove("hidden");

  updateGameInfo();
  buildHead();
  renderGrid();
}

restoreGame();
