import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'archaeology-field:entries'
// 标本室设定（换人/退样冲突优先级等）单独存，不混入业务清单。
const SETTINGS_KEY = 'archaeology-field:bone-settings'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 旧版本浏览器里存的数据没有新登记的字段（如归属单位），
// 按 id 用种子数据把缺的列补齐，用户已经改过的值保持不动。
function mergeWithSeed(
  stored: Record<string, EntryRow[]>,
  fallback: Record<string, EntryRow[]>,
): Record<string, EntryRow[]> {
  const merged = clone(stored)
  for (const key of Object.keys(fallback)) {
    const seedRows = fallback[key]
    const rows = merged[key]
    if (!rows) {
      merged[key] = clone(seedRows)
      continue
    }
    merged[key] = rows.map((row) => {
      const seed = seedRows.find((item) => item.id === row.id)
      return seed ? { ...clone(seed), ...clone(row) } : row
    })
    // 种子里新增（用户存储中还没有）的示例行也补进来。
    for (const seed of seedRows) {
      if (!merged[key].some((row) => row.id === seed.id)) {
        merged[key].push(clone(seed))
      }
    }
  }
  return merged
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return mergeWithSeed(parsed, fallback)
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

export type BoneSettings = {
  // 换人与退样申请撞在一起时标本室定的优先级。
  conflictPriority: '换人优先' | '退样优先'
}

export const DEFAULT_BONE_SETTINGS: BoneSettings = { conflictPriority: '退样优先' }

export function loadBoneSettings(): BoneSettings {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_BONE_SETTINGS }
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (!raw) {
      return { ...DEFAULT_BONE_SETTINGS }
    }
    return { ...DEFAULT_BONE_SETTINGS, ...(JSON.parse(raw) as Partial<BoneSettings>) }
  } catch {
    return { ...DEFAULT_BONE_SETTINGS }
  }
}

export function saveBoneSettings(settings: BoneSettings): BoneSettings {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }
  return settings
}
