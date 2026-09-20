// Transliteration helper for slugs and codes

const CYRILLIC_TO_LATIN_MAP: Record<string, string> = {
  '\u0430': 'a', '\u0431': 'b', '\u0432': 'v', '\u0433': 'g', '\u0434': 'd', '\u0435': 'e', '\u0451': 'yo',
  '\u0436': 'zh', '\u0437': 'z', '\u0438': 'i', '\u0439': 'y', '\u043a': 'k', '\u043b': 'l', '\u043c': 'm',
  '\u043d': 'n', '\u043e': 'o', '\u043f': 'p', '\u0440': 'r', '\u0441': 's', '\u0442': 't', '\u0443': 'u',
  '\u0444': 'f', '\u0445': 'kh', '\u0446': 'ts', '\u0447': 'ch', '\u0448': 'sh', '\u0449': 'shch',
  '\u044a': '', '\u044b': 'y', '\u044c': '', '\u044d': 'e', '\u044e': 'yu', '\u044f': 'ya',
  '\u045e': 'o', '\u049b': 'q', '\u0493': 'g', '\u04b3': 'h', '\u04b7': 'j', '\u04d9': 'a', '\u0456': 'i',
  '\u04a3': 'n', '\u04e9': 'o', '\u04af': 'u', '\u04b1': 'u'
};

export function transliterateToCode(str: string): string {
  let result = '';
  for (const char of str.toLowerCase()) {
    if (CYRILLIC_TO_LATIN_MAP[char] !== undefined) {
      result += CYRILLIC_TO_LATIN_MAP[char];
    } else {
      result += char;
    }
  }
  return result
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
