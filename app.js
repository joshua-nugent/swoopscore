const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let game = { mode: "rounds", target: 10, players: [], rounds: [] };

// --- Recent names (localStorage) ---

const STORAGE_KEY = "swoopscore_recent_names";

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

function renderRecentNames() {
  const container = $("#recent-names");
  container.replaceChildren();
  const names = getRecentNames();
  if (names.length === 0) return;

  names.forEach((name) => {
    const tile = document.createElement("button");
    tile.className = "name-tile";
    tile.type = "button";
    tile.textContent = name;
    tile.addEventListener("click", () => {
      addPlayerWithName(name);
      ensureEmptyRow();
    });
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

// Mode toggle
$$(".toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".toggle").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    game.mode = btn.dataset.mode;
    $("#target-label").textContent =
      game.mode === "score" ? "Target score" : "Number of rounds";
    $("#target").value = game.mode === "score" ? 100 : 10;
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

// Auto-spawn: when typing in the last row, add a new empty one
$("#player-list").addEventListener("input", (e) => {
  if (!e.target.classList.contains("player-name")) return;
  ensureEmptyRow();
});

// Remove player
$("#player-list").addEventListener("click", (e) => {
  if (!e.target.classList.contains("remove-player")) return;
  const rows = $$("#player-list .player-row");
  if (rows.length <= 2) return;
  e.target.closest(".player-row").remove();
  // Re-number placeholders
  $$("#player-list .player-name").forEach((inp, i) => {
    inp.placeholder = `Player ${i + 1}`;
  });
});

// Start game
$("#start-game").addEventListener("click", () => {
  // Collect non-empty names, assign defaults
  const allInputs = [...$$(".player-name")];
  const filled = allInputs.filter((inp) => inp.value.trim() !== "");
  if (filled.length < 2) return;

  let idx = 1;
  const names = filled.map((inp) => inp.value.trim() || `Player ${idx++}`);

  game.target = parseInt($("#target").value) || (game.mode === "rounds" ? 10 : 100);
  game.players = names;
  game.rounds = [];

  const realNames = names.filter((n) => !n.match(/^Player \d+$/));
  if (realNames.length > 0) saveRecentNames(realNames);

  showScoring();
});

// --- Scoring screen ---

function showScoring() {
  $("#setup").classList.remove("active");
  $("#scoring").classList.add("active");

  const label = game.mode === "score"
    ? `First to ${game.target}`
    : `${game.target} rounds`;
  $("#game-info").textContent = label;

  buildHead();

  if (game.mode === "rounds") {
    for (let r = 0; r < game.target; r++) {
      game.rounds.push(new Array(game.players.length).fill(0));
    }
    $("#add-round").classList.add("hidden");
  } else {
    game.rounds.push(new Array(game.players.length).fill(0));
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

function renderGrid() {
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
      input.value = val || "";
      input.dataset.round = r;
      input.dataset.player = p;
      input.addEventListener("input", onScoreInput);
      input.addEventListener("focus", () => input.select());
      td.appendChild(input);
      tr.appendChild(td);
    });

    body.appendChild(tr);
  });

  updateTotals();

  const lastRound = game.rounds.length - 1;
  const firstInput = body.querySelector(
    `input[data-round="${lastRound}"][data-player="0"]`
  );
  if (firstInput) firstInput.select();
}

function onScoreInput(e) {
  const r = parseInt(e.target.dataset.round);
  const p = parseInt(e.target.dataset.player);
  game.rounds[r][p] = parseInt(e.target.value) || 0;
  updateTotals();
}

function updateTotals() {
  const foot = $("#grid-foot");
  const tr = document.createElement("tr");

  const label = document.createElement("td");
  label.textContent = "Total";
  tr.appendChild(label);

  const totals = game.players.map((_, p) =>
    game.rounds.reduce((sum, round) => sum + round[p], 0)
  );
  const maxTotal = Math.max(...totals);

  totals.forEach((total) => {
    const td = document.createElement("td");
    td.textContent = total;
    if (total === maxTotal && maxTotal > 0) td.className = "leader";
    tr.appendChild(td);
  });

  foot.replaceChildren(tr);

  if (game.mode === "score") {
    const winner = totals.findIndex((t) => t >= game.target);
    if (winner !== -1) showGameOver(winner, totals[winner]);
  }
}

// Add round (score mode only)
$("#add-round").addEventListener("click", () => {
  game.rounds.push(new Array(game.players.length).fill(0));
  renderGrid();
});

function showGameOver(winnerIdx, score) {
  $("#add-round").classList.add("hidden");
  $("#game-over").classList.remove("hidden");
  $("#winner-text").textContent = `${game.players[winnerIdx]} wins with ${score} points!`;
}

function resetToSetup() {
  $("#scoring").classList.remove("active");
  $("#setup").classList.add("active");
  $("#game-over").classList.add("hidden");
  $("#add-round").classList.add("hidden");
  $("#grid-body").replaceChildren();
  $("#grid-foot").replaceChildren();
  renderRecentNames();
}

$("#new-game").addEventListener("click", resetToSetup);

$("#back-btn").addEventListener("click", () => {
  if (confirm("End this game and go back to setup?")) resetToSetup();
});
