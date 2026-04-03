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
  // Merge new names to front, deduplicate (case-insensitive), cap at 20
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
    tile.textContent = name;
    tile.addEventListener("click", () => addPlayerWithName(name));
    container.appendChild(tile);
  });
}

function addPlayerWithName(name) {
  // If there's an empty input, fill it instead of adding a new row
  const emptyInput = [...$$(".player-name")].find((inp) => inp.value.trim() === "");
  if (emptyInput) {
    emptyInput.value = name;
    return;
  }

  const count = $$("#player-list .player-row").length + 1;
  const row = document.createElement("div");
  row.className = "player-row";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "player-name";
  input.placeholder = `Player ${count}`;
  input.value = name;

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-player";
  removeBtn.setAttribute("aria-label", "Remove");
  removeBtn.textContent = "\u00d7";

  row.appendChild(input);
  row.appendChild(removeBtn);
  $("#player-list").appendChild(row);
}

renderRecentNames();

// --- Setup screen ---

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

$("#add-player").addEventListener("click", () => {
  const count = $$("#player-list .player-row").length + 1;
  const row = document.createElement("div");
  row.className = "player-row";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "player-name";
  input.placeholder = `Player ${count}`;

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-player";
  removeBtn.setAttribute("aria-label", "Remove");
  removeBtn.textContent = "\u00d7";

  row.appendChild(input);
  row.appendChild(removeBtn);
  $("#player-list").appendChild(row);
  input.focus();
});

$("#player-list").addEventListener("click", (e) => {
  if (!e.target.classList.contains("remove-player")) return;
  if ($$("#player-list .player-row").length <= 2) return;
  e.target.closest(".player-row").remove();
});

$("#start-game").addEventListener("click", () => {
  const names = [...$$(".player-name")].map(
    (input, i) => input.value.trim() || `Player ${i + 1}`
  );
  if (names.length < 2) return;

  game.target = parseInt($("#target").value) || (game.mode === "rounds" ? 10 : 100);
  game.players = names;
  game.rounds = [];

  // Save non-default names for quick-add next time
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
    // Pre-fill all round rows
    for (let r = 0; r < game.target; r++) {
      game.rounds.push(new Array(game.players.length).fill(0));
    }
    $("#add-round").classList.add("hidden");
  } else {
    // Start with one round
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
    label.textContent = `Round ${r + 1}`;
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

  // Focus the first empty input of the last round
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

  // Check win condition for "play to score" mode
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

// For rounds mode, check when all inputs are filled
function checkRoundsComplete() {
  const allFilled = game.rounds.every((round) =>
    round.some((v) => v !== 0)
  );
  if (!allFilled) return;

  const totals = game.players.map((_, p) =>
    game.rounds.reduce((sum, round) => sum + round[p], 0)
  );
  const maxTotal = Math.max(...totals);
  const winner = totals.indexOf(maxTotal);
  showGameOver(winner, maxTotal);
}

// New game
$("#new-game").addEventListener("click", () => {
  $("#scoring").classList.remove("active");
  $("#setup").classList.add("active");
  $("#game-over").classList.add("hidden");
  $("#grid-body").replaceChildren();
  $("#grid-foot").replaceChildren();
  renderRecentNames();
});

// Back button
$("#back-btn").addEventListener("click", () => {
  if (confirm("End this game and go back to setup?")) {
    $("#scoring").classList.remove("active");
    $("#setup").classList.add("active");
    $("#game-over").classList.add("hidden");
    $("#add-round").classList.add("hidden");
    $("#grid-body").replaceChildren();
    $("#grid-foot").replaceChildren();
    renderRecentNames();
  }
});
