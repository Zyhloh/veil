export function parseAppIds(text: string): number[] {
  const ids = new Set<number>()

  const urlRe = /(?:steampowered\.com|steamdb\.info|steamcommunity\.com)\/(?:app|depot|sub)\/(\d+)/gi
  for (const m of text.matchAll(urlRe)) ids.add(Number(m[1]))

  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d{3,})\b/)
    if (m) ids.add(Number(m[1]))
  }

  if (ids.size === 0) {
    for (const m of text.matchAll(/\b(\d{4,})\b/g)) ids.add(Number(m[1]))
  }

  return [...ids].filter((n) => n > 0 && n < 2_000_000_000)
}
