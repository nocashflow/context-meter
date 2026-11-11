// The shapes of the data the mod keeps around. TypeScript uses these to
// yell before a typo ships, which has already saved this project twice.

export type Mode = 'band' | 'pane' | 'both' | 'off'

export type Category = { name: string; tokens: number }

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Snapshot = {
  tokens?: number
  window: number
  /** Where auto-compact kicks in, if Claude Code tells us. */
  compactAt?: number
  percent?: number
  costUsd?: number
  limits: Limit[]
  categories: Category[]
  /** How much the last reply added. Goes negative after a compaction. */
  lastDelta?: number
  /** Context size after every reply this session, oldest first.
   *  This is what the little growth chart is drawn from. */
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
