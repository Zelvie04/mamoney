/** Нормализация для сравнения названий и категорий: регистр, ё→е, лишние символы. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/[\s-]+/g, ' ')
    .trim();
}

/** Регулярка «целое слово» для кириллицы: \b в JS понимает только латиницу. */
export function wordRe(words: readonly string[], flags = 'giu'): RegExp {
  const alt = [...words]
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])`, flags);
}
