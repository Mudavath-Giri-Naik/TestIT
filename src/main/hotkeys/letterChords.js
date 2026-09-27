// Letter chords: modifier-free global shortcuts made of two letters, written
// "J+T" — hold the first letter, then tap the second (like using J as Shift).
//
// Only the first letter of a chord (the "prefix") is ever intercepted. While a
// prefix is held, it is withheld from the focused app until we know what the
// user meant:
//   - a chord partner is pressed  -> fire the chord, swallow both letters
//   - the prefix is released alone -> replay it as a normal tap ("j")
//   - any other key is pressed     -> replay the prefix, then that key, in order
//   - it is held past holdTimeoutMs -> replay it so autorepeat still works
// A held prefix is only trusted while its autorepeat keeps arriving: if no
// key-down for it has been seen for staleMs, its key-up was lost (Windows skips
// a low-level hook that responds too slowly) and it is treated as released, so
// a lone partner letter can never fire a chord.
// Every other key passes straight through untouched.

const CHORD_PATTERN = /^([A-Z])\+([A-Z])$/;

function parseLetterChord(accelerator) {
  const match = CHORD_PATTERN.exec(String(accelerator || ''));
  if (!match || match[1] === match[2]) return null;
  // Windows virtual-key codes for A–Z equal their ASCII codes.
  return { prefix: match[1].charCodeAt(0), key: match[2].charCodeAt(0) };
}

function isLetterChord(accelerator) {
  return parseLetterChord(accelerator) !== null;
}

class LetterChordDetector {
  /**
   * @param {{
   *   replay: (events: Array<{ vk: number, scanCode: number, down: boolean }>) => void,
   *   onChord: (accelerator: string) => void,
   *   holdTimeoutMs?: number,
   *   staleMs?: number,
   *   now?: () => number,
   *   setTimer?: Function,
   *   clearTimer?: Function,
   * }} options
   */
  constructor({ replay, onChord, holdTimeoutMs = 800, staleMs = 1500, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.replay = replay;
    this.onChord = onChord;
    this.holdTimeoutMs = holdTimeoutMs;
    this.staleMs = staleMs;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.chords = new Map(); // prefix vk -> Map(key vk -> accelerator)
    this.pending = null;     // { vk, scanCode, fired, timer, lastSeen }
    this.consumed = new Set(); // chord partner keys whose repeats/release we still swallow
    this.released = new Set(); // prefixes already replayed while still held; pass until key-up
  }

  setChords(accelerators) {
    this.chords = new Map();
    for (const accelerator of accelerators) {
      const chord = parseLetterChord(accelerator);
      if (!chord) continue;
      if (!this.chords.has(chord.prefix)) this.chords.set(chord.prefix, new Map());
      this.chords.get(chord.prefix).set(chord.key, accelerator);
    }
    if (this.pending && !this.chords.has(this.pending.vk)) this.flush();
  }

  /**
   * @param {{ vk: number, scanCode: number, down: boolean, modifiersDown?: () => boolean }} event
   * @returns {boolean} true when the key must be withheld from the focused app
   */
  handleKey({ vk, scanCode, down, modifiersDown = () => false }) {
    if (this.pending && vk !== this.pending.vk && this.now() - this.pending.lastSeen > this.staleMs) {
      // The prefix's key-up never arrived; stop treating it (and its partners) as held.
      this.clearPending();
      this.consumed.clear();
    }
    const pending = this.pending;

    if (this.released.has(vk)) {
      if (!down) this.released.delete(vk);
      return false;
    }

    if (this.consumed.has(vk) && (!pending || vk !== pending.vk)) {
      if (!down) this.consumed.delete(vk);
      return true;
    }

    if (pending) {
      if (vk === pending.vk) {
        if (down) { pending.lastSeen = this.now(); return true; } // autorepeat while we wait
        this.clearPending();
        if (!pending.fired) this.replay([{ vk, scanCode, down: true }, { vk, scanCode, down: false }]);
        return true;
      }
      if (!down) return false; // releasing some other key doesn't affect the held prefix

      const accelerator = this.chords.get(pending.vk)?.get(vk);
      if (accelerator && !modifiersDown()) {
        // Keep the prefix held so further partners can fire while it stays down.
        if (pending.timer) this.clearTimer(pending.timer);
        pending.timer = null;
        pending.fired = true;
        this.consumed.add(vk);
        this.onChord(accelerator);
        return true;
      }
      if (pending.fired) return false; // prefix already consumed; type normally
      this.clearPending();
      this.replay([
        { vk: pending.vk, scanCode: pending.scanCode, down: true },
        { vk, scanCode, down: true },
      ]);
      return true;
    }

    if (down && this.chords.has(vk) && !modifiersDown()) {
      this.pending = { vk, scanCode, fired: false, timer: null, lastSeen: this.now() };
      this.pending.timer = this.setTimer(() => {
        if (this.pending && this.pending.vk === vk && !this.pending.fired) this.flush();
      }, this.holdTimeoutMs);
      return true;
    }
    return false;
  }

  // Releases a withheld prefix as a key-down; its autorepeat and key-up then
  // pass through normally.
  flush() {
    const pending = this.pending;
    if (!pending) return;
    this.clearPending();
    if (pending.fired) return;
    this.released.add(pending.vk);
    this.replay([{ vk: pending.vk, scanCode: pending.scanCode, down: true }]);
  }

  reset() {
    this.flush();
    this.consumed.clear();
    this.released.clear();
  }

  clearPending() {
    if (this.pending?.timer) this.clearTimer(this.pending.timer);
    this.pending = null;
  }
}

module.exports = {
  LetterChordDetector,
  isLetterChord,
  parseLetterChord,
};
