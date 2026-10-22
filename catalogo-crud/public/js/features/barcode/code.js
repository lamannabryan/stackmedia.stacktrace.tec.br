export function normalizeEan(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 14);
}

export function isValidEan(ean) {
  if (!/^(?:\d{8}|\d{12,14})$/.test(ean) || /^0+$/.test(ean)) return false;
  const digits = [...ean].map(Number);
  const checkDigit = digits.pop();
  const sum = digits.reduce((total, digit, index) => (
    total + digit * ((digits.length - 1 - index) % 2 === 0 ? 3 : 1)
  ), 0);
  return (10 - sum % 10) % 10 === checkDigit;
}
