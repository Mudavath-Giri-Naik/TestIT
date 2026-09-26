const assert = require('node:assert/strict');
const test = require('node:test');
const { LetterChordDetector, parseLetterChord } = require('../src/main/hotkeys/letterChords');

const vk = (letter) => letter.charCodeAt(0);
const SPACE = 0x20;

function createDetector(chords = ['J+T', 'J+H']) {
  const replayed = [];
  const fired = [];
  const timers = [];
  const detector = new LetterChordDetector({
    replay: (events) => replayed.push(...events.map(e => `${String.fromCharCode(e.vk)}${e.down ? '↓' : '↑'}`)),
    onChord: (accelerator) => fired.push(accelerator),
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: (id) => { timers[id - 1] = null; },
  });
  detector.setChords(chords);
  const press = (key, down, modifiers = false) => detector.handleKey({
    vk: typeof key === 'number' ? key : vk(key),
    scanCode: 0,
    down,
    modifiersDown: () => modifiers,
  });
  const runTimers = () => timers.splice(0).forEach(fn => fn && fn());
  return { detector, replayed, fired, press, runTimers };
}

test('parses chords into virtual-key codes', () => {
  assert.deepEqual(parseLetterChord('J+T'), { prefix: vk('J'), key: vk('T') });
  assert.equal(parseLetterChord('J+J'), null);
  assert.equal(parseLetterChord('Ctrl+J'), null);
});

test('hold J, tap T fires the chord and swallows every keystroke', () => {
  const { replayed, fired, press } = createDetector();
  assert.equal(press('J', true), true);
  assert.equal(press('T', true), true);
  assert.equal(press('T', false), true);
  assert.equal(press('J', false), true);
  assert.deepEqual(fired, ['J+T']);
  assert.deepEqual(replayed, []);
});

test('several chords can fire while J stays held', () => {
  const { fired, press } = createDetector();
  press('J', true);
  press('T', true); press('T', false);
  press('H', true); press('H', false);
  press('J', false);
  assert.deepEqual(fired, ['J+T', 'J+H']);
});

test('tapping J alone still types "j"', () => {
  const { replayed, fired, press } = createDetector();
  assert.equal(press('J', true), true);
  assert.equal(press('J', false), true);
  assert.deepEqual(replayed, ['J↓', 'J↑']);
  assert.deepEqual(fired, []);
});

test('rolling from J into a non-chord key keeps the typed order', () => {
  const { replayed, fired, press } = createDetector();
  press('J', true);
  assert.equal(press('O', true), true);
  assert.deepEqual(replayed, ['J↓', 'O↓']);
  // Both releases now pass through untouched.
  assert.equal(press('J', false), false);
  assert.equal(press('O', false), false);
  assert.deepEqual(fired, []);
});

test('non-chord keys are never touched', () => {
  const { replayed, press } = createDetector();
  assert.equal(press('T', true), false);
  assert.equal(press('T', false), false);
  assert.equal(press(SPACE, true), false);
  assert.deepEqual(replayed, []);
});

test('holding J past the timeout releases it so autorepeat works', () => {
  const { replayed, press, runTimers } = createDetector();
  press('J', true);
  runTimers();
  assert.deepEqual(replayed, ['J↓']);
  assert.equal(press('J', true), false); // autorepeat passes through
  assert.equal(press('T', true), false); // too late for a chord
  assert.equal(press('J', false), false);
});

test('modifiers bypass chords so Ctrl+J etc. keep working', () => {
  const { fired, press } = createDetector();
  assert.equal(press('J', true, true), false);
  assert.equal(press('T', true, true), false);
  assert.deepEqual(fired, []);
});
