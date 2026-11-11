export type Mode = 'band' | 'pane' | 'both' | 'off'

export type Category = { name: string; tokens: number }

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Snapshot = {
  tokens?: number
  window: number
  /** Where auto-compact kicks in, when the engine reports it. */
  compactAt?: number
  percent?: number
  costUsd?: number
  limits: Limit[]
  categories: Category[]
  /** Tokens the most recent reply added (negative after a compaction). */
  lastDelta?: number
  /** Context size after each reply this session, oldest first. */
  history: number[]
}

declare module 'claude-code' {
  interface PluginState {
    'context-meter': {
      mode: Mode
      snap: Shaped<Snapshot | null>
    }
  }
}
