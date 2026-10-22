/** Only server-provided prices from the current active magazine qualify. */
export function suggestedMagazinePrice(product) {
  const cents = product?.revista_preco_centavos;
  return Number.isSafeInteger(cents) && cents > 0 ? formatPriceInput(cents) : '';
}

/** Formats entered digits as BRL cents without floating-point rounding. */
export function formatPriceInput(value, { deleting = false } = {}) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits || (deleting && !/[1-9]/.test(digits))) return '';
  const padded = digits.replace(/^0+(?=\d)/, '').padStart(3, '0');
  const reais = padded.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${reais},${padded.slice(-2)}`;
}

function caretBeforeTrailingDigits(value, count) {
  let position = value.length;
  while (position > 0 && count > 0) {
    position -= 1;
    if (/\d/.test(value[position])) count -= 1;
  }
  return position;
}

/** Reads the live field so product/mode changes can still clear or replace it. */
export function bindPriceInput(input, onChange) {
  function normalize(deleting = false) {
    const raw = input.value;
    const caret = input.selectionStart ?? raw.length;
    const trailingDigits = raw.slice(caret).replace(/\D/g, '').length;
    const formatted = formatPriceInput(raw, { deleting });
    if (formatted !== raw) {
      input.value = formatted;
      const nextCaret = caret === 0 ? 0 : caretBeforeTrailingDigits(formatted, trailingDigits);
      input.setSelectionRange(nextCaret, nextCaret);
    }
    onChange(formatted);
  }

  input.addEventListener('beforeinput', (event) => {
    if (!event.cancelable || event.isComposing || input.disabled || input.readOnly
      || input.selectionStart === null || input.selectionStart !== input.selectionEnd) return;
    const direction = event.inputType === 'deleteContentBackward' ? -1
      : event.inputType === 'deleteContentForward' ? 1 : 0;
    if (!direction) return;
    const caret = input.selectionStart;
    let position = direction < 0 ? caret - 1 : caret;
    // Deleting a grouping separator should remove the adjacent digit, rather
    // than reinserting the separator and making Backspace appear unresponsive.
    if (position < 0 || position >= input.value.length || /\d/.test(input.value[position])) return;
    while (position >= 0 && position < input.value.length && !/\d/.test(input.value[position])) position += direction;
    if (position < 0 || position >= input.value.length) return;
    event.preventDefault();
    input.value = input.value.slice(0, position) + input.value.slice(position + 1);
    const nextCaret = direction < 0 ? position : caret;
    input.setSelectionRange(nextCaret, nextCaret);
    normalize(true);
  });
  input.addEventListener('input', (event) => {
    if (!event.isComposing) normalize(event.inputType?.startsWith('delete'));
  });
  input.addEventListener('compositionend', () => normalize());
  input.addEventListener('blur', () => normalize());
}
