const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "..", "data", "state.json");

const gameKey = (game) => `${game.kind}:${game.appId}`;

function readState() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return { pending: state.pending || [], seen: state.seen || {} };
  } catch {
    return { pending: [], seen: {} };
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

module.exports = { readState, writeState, gameKey };
