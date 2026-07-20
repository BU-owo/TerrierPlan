export function normalizeCourseKey(input) {
  return input.replace(/\s+/g, '').toUpperCase();
}
