// Display-only tidy-up for catalog course titles that are ALL CAPS (the
// abbreviated schedule names, e.g. "DATA MANAGEMENT" -> "Data Management").
// A title with any lowercase letter is returned unchanged. Words of 3 letters
// or fewer stay as they are (acronyms and abbreviations: "AI", "HUB", "DS",
// "SEM", "II"), and so do roman numerals ("VIII"). An apostrophe stays inside
// its word ("WOMEN'S" -> "Women's"). The catalog itself is never changed.
const ROMAN_NUMERAL = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

export function displayCourseTitle(name) {
  if (typeof name !== 'string' || /[a-z]/.test(name)) return name;
  return name.replace(/[A-Z]+(?:'[A-Z]+)*/g, (word) => (
    word.length <= 3 || ROMAN_NUMERAL.test(word) ? word : word[0] + word.slice(1).toLowerCase()
  ));
}
