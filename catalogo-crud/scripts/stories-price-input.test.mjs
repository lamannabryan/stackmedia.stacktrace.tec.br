import assert from 'node:assert/strict';
import test from 'node:test';
import { bindPriceInput, formatPriceInput } from '../public/js/features/stories/price-input.js';

function createInput(initialValue = '') {
  const listeners = new Map();
  let value = initialValue;
  const input = {
    disabled: false,
    readOnly: false,
    selectionStart: value.length,
    selectionEnd: value.length,
    get value() { return value; },
    set value(nextValue) {
      value = String(nextValue);
      this.selectionStart = value.length;
      this.selectionEnd = value.length;
    },
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
    addEventListener(type, listener) {
      const callbacks = listeners.get(type) ?? [];
      callbacks.push(listener);
      listeners.set(type, callbacks);
    },
    dispatch(type, properties = {}) {
      const event = {
        cancelable: true,
        defaultPrevented: false,
        isComposing: false,
        ...properties,
        preventDefault() { if (this.cancelable) this.defaultPrevented = true; },
      };
      for (const listener of listeners.get(type) ?? []) listener(event);
      return event;
    },
  };
  return input;
}

function boundInput(initialValue = '') {
  const input = createInput(initialValue);
  const changes = [];
  bindPriceInput(input, (value) => changes.push(value));
  return { input, changes };
}

// Emulate native editing between beforeinput and input, including selections.
function edit(input, inputType, data = '') {
  if (input.disabled || input.readOnly) return;
  const event = input.dispatch('beforeinput', { inputType, data });
  if (event.defaultPrevented) return;
  let start = input.selectionStart;
  let end = input.selectionEnd;
  if (start === end && inputType === 'deleteContentBackward') start = Math.max(0, start - 1);
  if (start === end && inputType === 'deleteContentForward') end = Math.min(input.value.length, end + 1);
  const inserted = inputType.startsWith('delete') ? '' : data;
  input.value = input.value.slice(0, start) + inserted + input.value.slice(end);
  input.setSelectionRange(start + inserted.length, start + inserted.length);
  input.dispatch('input', { inputType, data });
}

test('typing digits fills cents first and adds thousands separators', () => {
  const { input, changes } = boundInput();
  const values = ['0,01', '0,12', '1,23', '12,34', '123,45', '1.234,56'];
  for (const [index, digit] of [...'123456'].entries()) {
    edit(input, 'insertText', digit);
    assert.equal(input.value, values[index]);
    assert.equal(input.selectionStart, input.value.length);
  }
  assert.deepEqual(changes, values);
});

test('backspace removes cents through grouping changes until the field is empty', () => {
  const { input, changes } = boundInput('1.234,56');
  const values = ['123,45', '12,34', '1,23', '0,12', '0,01', ''];
  for (const value of values) {
    edit(input, 'deleteContentBackward');
    assert.equal(input.value, value);
    assert.equal(input.selectionStart, input.value.length);
  }
  assert.deepEqual(changes, values);
});

test('an explicitly typed zero remains visible and can be deleted', () => {
  const { input, changes } = boundInput();
  edit(input, 'insertText', '0');
  assert.equal(input.value, '0,00');
  input.dispatch('blur');
  assert.equal(input.value, '0,00');
  edit(input, 'deleteContentBackward');
  assert.equal(input.value, '');
  assert.equal(changes.at(-1), '');
});

test('pasting raw cents or a Brazilian formatted price gives the same price', () => {
  for (const pasted of ['123456', '1.234,56', 'R$ 1.234,56', ' R$\u00a01.234,56 ']) {
    const { input, changes } = boundInput();
    edit(input, 'insertFromPaste', pasted);
    assert.equal(input.value, '1.234,56', pasted);
    assert.equal(changes.at(-1), '1.234,56', pasted);
  }
  const { input } = boundInput();
  edit(input, 'insertFromPaste', '29,99');
  assert.equal(input.value, '29,99');
});

test('blur preserves a formatted price without shifting its decimal places', () => {
  const { input, changes } = boundInput();
  edit(input, 'insertFromPaste', '2999');
  input.dispatch('blur');
  input.dispatch('blur');
  assert.equal(input.value, '29,99');
  assert.deepEqual(changes, ['29,99', '29,99', '29,99']);
});

test('selecting all supports replacing a price and clearing it entirely', () => {
  const { input, changes } = boundInput('1.234,56');
  input.setSelectionRange(0, input.value.length);
  edit(input, 'insertText', '5');
  assert.equal(input.value, '0,05');
  edit(input, 'insertText', '0');
  assert.equal(input.value, '0,50');
  input.setSelectionRange(0, input.value.length);
  edit(input, 'deleteContentForward');
  assert.equal(input.value, '');
  input.dispatch('blur');
  assert.equal(input.value, '');
  assert.equal(changes.at(-1), '');
});

test('inserting in the middle keeps the caret beside the edited digit after regrouping', () => {
  const { input, changes } = boundInput('123,45');
  input.setSelectionRange(2, 2);
  edit(input, 'insertText', '9');
  assert.equal(input.value, '1.293,45');
  assert.equal(input.selectionStart, 4);
  assert.equal(input.selectionEnd, 4);
  edit(input, 'deleteContentBackward');
  assert.equal(input.value, '123,45');
  assert.equal(input.selectionStart, 2);
  assert.deepEqual(changes, ['1.293,45', '123,45']);
});

test('backspace and delete beside separators remove an adjacent digit', () => {
  const scenarios = [
    { value: '12,34', caret: 3, action: 'deleteContentBackward', expected: '1,34' },
    { value: '12,34', caret: 2, action: 'deleteContentForward', expected: '1,24' },
    { value: '1.234,56', caret: 2, action: 'deleteContentBackward', expected: '234,56' },
    { value: '1.234,56', caret: 1, action: 'deleteContentForward', expected: '134,56' },
  ];
  for (const { value, caret, action, expected } of scenarios) {
    const { input, changes } = boundInput(value);
    input.setSelectionRange(caret, caret);
    edit(input, action);
    assert.equal(input.value, expected, `${action} at ${caret} in ${value}`);
    assert.deepEqual(changes, [expected]);
  }
});

test('programmatic product or composition changes become the next editing value', () => {
  const { input, changes } = boundInput();
  edit(input, 'insertFromPaste', '2999');
  input.value = '';
  edit(input, 'insertText', '5');
  assert.equal(input.value, '0,05');
  input.value = '22,40';
  edit(input, 'insertText', '9');
  assert.equal(input.value, '224,09');
  assert.deepEqual(changes, ['29,99', '0,05', '224,09']);
});

test('two product fields keep their values and callbacks independent', () => {
  const primary = boundInput();
  const secondary = boundInput();
  edit(primary.input, 'insertFromPaste', '2999');
  edit(secondary.input, 'insertFromPaste', '2240');
  edit(primary.input, 'deleteContentBackward');
  assert.equal(primary.input.value, '2,99');
  assert.equal(secondary.input.value, '22,40');
  assert.deepEqual(primary.changes, ['29,99', '2,99']);
  assert.deepEqual(secondary.changes, ['22,40']);
});

test('formatting keeps empty input empty and cents exact beyond floating point precision', () => {
  assert.equal(formatPriceInput(''), '');
  assert.equal(formatPriceInput(null), '');
  assert.equal(formatPriceInput('R$'), '');
  assert.equal(formatPriceInput('0'), '0,00');
  assert.equal(formatPriceInput('000123'), '1,23');
  assert.equal(formatPriceInput('900719925474099199'), '9.007.199.254.740.991,99');
});
