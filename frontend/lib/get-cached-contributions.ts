import type { Activity } from "@/components/contribution-graph"

// Craton activity (commits, reviews, releases) for a profile's heat map.
// Generated locally and deterministically: no third-party request, no waiting,
// and the same user always gets the same graph (DESIGN.md §9: zero runtime third-party calls).

const memoryCache = new Map<string, Activity[]>()

function generateYearContributions(username: string): Activity[] {
  const list: Activity[] = []
  // UTC calendar dates only, so the server and the browser produce identical data in any time zone.
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  let seed = 42
  for (let i = 0; i < username.length; i++) {
    seed += username.charCodeAt(i) * 19
  }
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }

  for (let i = 364; i >= 0; i--) {
    const d = new Date(todayUtc - i * 86_400_000)
    const dateStr = d.toISOString().split("T")[0]
    const r = rand()
    let count = 0
    let level = 0
    // More activity in the monsoon months (June–September), when models are recalibrated.
    const month = d.getUTCMonth()
    const isPeakMonsoon = month >= 5 && month <= 8
    const threshold = isPeakMonsoon ? 0.35 : 0.55
    if (r > threshold) {
      level = Math.floor(rand() * 4) + 1
      count = level * 3 + Math.floor(rand() * 4)
    }
    list.push({ date: dateStr, count, level })
  }
  return list
}

export function getContributions(username: string): Activity[] {
  // Keyed by UTC day: a long-running server must not serve yesterday's calendar.
  const key = `${username}:${new Date().toISOString().slice(0, 10)}`
  const cached = memoryCache.get(key)
  if (cached) return cached
  const data = generateYearContributions(username)
  memoryCache.set(key, data)
  return data
}

/** Kept for existing callers; resolves immediately. */
export async function getCachedContributions(username: string): Promise<Activity[]> {
  return getContributions(username)
}

/** A year of real activity (ISO timestamps of pushes, reviews, comments…) as heat-map days. */
export function contributionsFrom(times: string[]): Activity[] {
  const counts = new Map<string, number>()
  for (const t of times) {
    const day = t.slice(0, 10)
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const list: Activity[] = []
  for (let i = 364; i >= 0; i--) {
    const date = new Date(todayUtc - i * 86_400_000).toISOString().slice(0, 10)
    const count = counts.get(date) ?? 0
    const level = count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 5 ? 3 : 4
    list.push({ date, count, level })
  }
  return list
}
