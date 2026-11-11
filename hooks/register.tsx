import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Mode, Snapshot } from '../types'

const PANE = 'context-meter'
const MODES: Mode[] = ['band', 'pane', 'both', 'off']
const HISTORY_MAX = 60

const mode = atom({ plugin: 'context-meter', key: 'mode' } as const, 'band' as Mode)
// Bump the tag whenever Snapshot's fields change: it declines what an older
// version stored, which outlives a reload.
const snap = atom({ plugin: 'context-meter', key: 'snap' } as const, null, {
  shape: 'snap-2',
})

const showsBand = (m: Mode) => m === 'band' || m === 'both'
const showsPane = (m: Mode) => m === 'pane' || m === 'both'

// ── Palette ──────────────────────────────────────────────────────────────
// The mod can't tell whether the app is light or dark, so every colour is a
// mid-tone that reads on both, and tracks are translucent grey.
const OK = '#3FA672'
const WARN = '#D99A2B'
const CRIT = '#E0564F'
const TRACK = 'rgba(128,128,128,0.22)'
const LINE = '#6F86F0'
const CATEGORY_COLORS = ['#6F86F0', '#3FA6A0', '#D99A2B', '#C46BB0', '#8A97A8', '#5BA3D9', '#9C7CE0']

const tone = (p: number) => (p >= 85 ? CRIT : p >= 70 ? WARN : OK)

// ── Formatting ───────────────────────────────────────────────────────────
const k = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${+(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`
  if (a >= 10_000) return `${Math.round(n / 1000)}k`
  if (a >= 1000) return `${+(n / 1000).toFixed(1)}k`
  return `${Math.round(n)}`
}

const pct = (p: number) => (p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`)

const limitName = (kind: string) =>
  kind === 'five_hour' ? '5-hour' : kind === 'seven_day' ? 'Weekly' : kind.replace(/_/g, ' ')

const resetIn = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const h = Math.floor(ms / 3_600_000)
  const m = Math.round((ms % 3_600_000) / 60_000)
  if (h >= 48) return `resets in ${Math.round(h / 24)}d`
  return h > 0 ? `resets in ${h}h ${m}m` : `resets in ${m}m`
}

/** Average growth per reply over the recent ones, ignoring compactions. */
const paceOf = (history: number[]) => {
  const steps: number[] = []
  for (let i = Math.max(1, history.length - 10); i < history.length; i++) {
    const d = (history[i] ?? 0) - (history[i - 1] ?? 0)
    if (d > 0) steps.push(d)
  }
  return steps.length >= 2 ? steps.reduce((a, b) => a + b, 0) / steps.length : undefined
}

const repliesLeft = (s: Snapshot) => {
  const pace = paceOf(s.history)
  if (!pace || s.tokens === undefined) return undefined
  const limit = s.compactAt ?? s.window
  return Math.max(0, Math.floor((limit - s.tokens) / pace))
}

// ── SVG pieces (drawn as images, so plain markup with no script) ─────────
const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`

const clamp = (p: number) => Math.max(0, Math.min(100, p))

/** The terminal has no SVG: a thin text bar stands in. */
const textBar = (p: number, width: number) => {
  const filled = Math.round((clamp(p) / 100) * width)
  return '━'.repeat(filled) + '─'.repeat(width - filled)
}

function barSvg(p: number, w: number, h: number, marker?: number) {
  const r = h / 2
  const fill = clamp(p) / 100 * w
  const minFill = p > 0 ? Math.max(fill, h) : 0
  const tick =
    marker !== undefined && marker > 0 && marker < 100
      ? `<rect x="${(marker / 100) * w - 1}" y="0" width="2" height="${h}" fill="rgba(128,128,128,0.65)"/>`
      : ''
  return svg(
    w,
    h,
    `<rect width="${w}" height="${h}" rx="${r}" fill="${TRACK}"/>` +
      (minFill > 0 ? `<rect width="${minFill}" height="${h}" rx="${r}" fill="${tone(p)}"/>` : '') +
      tick,
  )
}

function ringSvg(p: number, size: number, marker?: number) {
  const stroke = 9
  const r = (size - stroke) / 2
  const c = size / 2
  const circ = 2 * Math.PI * r
  const len = (clamp(p) / 100) * circ
  let tick = ''
  if (marker !== undefined && marker > 0 && marker < 100) {
    const a = (marker / 100) * 2 * Math.PI - Math.PI / 2
    const x1 = c + (r - stroke / 2 - 1) * Math.cos(a)
    const y1 = c + (r - stroke / 2 - 1) * Math.sin(a)
    const x2 = c + (r + stroke / 2 + 1) * Math.cos(a)
    const y2 = c + (r + stroke / 2 + 1) * Math.sin(a)
    tick = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(128,128,128,0.75)" stroke-width="2" stroke-linecap="round"/>`
  }
  return svg(
    size,
    size,
    `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="${stroke}"/>` +
      (len > 0
        ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${tone(p)}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${len} ${circ}" transform="rotate(-90 ${c} ${c})"/>`
        : '') +
      tick,
  )
}

function stackSvg(parts: { tokens: number; color: string }[], total: number, w: number, h: number) {
  let x = 0
  const gap = 2
  const rects = parts
    .map(part => {
      const width = Math.max(2, (part.tokens / total) * w - gap)
      const out = `<rect x="${x}" y="0" width="${width}" height="${h}" rx="2" fill="${part.color}"/>`
      x += width + gap
      return out
    })
    .join('')
  return svg(w, h, `<rect width="${w}" height="${h}" rx="3" fill="${TRACK}"/>${rects}`)
}

function sparkSvg(points: number[], max: number, w: number, h: number) {
  if (points.length < 2) return undefined
  const pad = 2
  const step = (w - pad * 2) / (points.length - 1)
  const y = (v: number) => h - pad - (Math.min(v, max) / max) * (h - pad * 2)
  const coords = points.map((v, i) => `${(pad + i * step).toFixed(1)},${y(v).toFixed(1)}`)
  const last = coords[coords.length - 1]!.split(',')
  return svg(
    w,
    h,
    `<polygon points="${pad},${h - pad} ${coords.join(' ')} ${(w - pad).toFixed(1)},${h - pad}" fill="${LINE}" fill-opacity="0.14"/>` +
      `<polyline points="${coords.join(' ')}" fill="none" stroke="${LINE}" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/>` +
      `<circle cx="${last[0]}" cy="${last[1]}" r="2.5" fill="${LINE}"/>`,
  )
}

// ── Reading usage ────────────────────────────────────────────────────────
// Never throws: a failed reading keeps the last numbers instead of
// disturbing the turn, compaction or click that asked for it.
async function refresh($: EngineInterface) {
  try {
    await readUsage($)
  } catch {
    // keep the previous snapshot
  }
}

async function readUsage($: EngineInterface) {
  // `summary` is estimated locally: no extra requests are sent.
  const usage = await $.session.usage({ breakdown: 'summary' })
  const ctx = usage.context
  const prev = await read($, snap)
  const breakdown = ctx.breakdown

  let history = prev?.history ?? []
  let lastDelta = prev?.lastDelta
  const tokens = ctx.tokens
  if (tokens !== undefined) {
    const before = history[history.length - 1]
    if (before === undefined) {
      history = [tokens]
    } else if (tokens !== before) {
      lastDelta = tokens - before
      // A big drop is a compaction or /clear: the old curve no longer applies.
      history = tokens < before * 0.6 ? [tokens] : [...history, tokens].slice(-HISTORY_MAX)
    }
  }

  const compactAt =
    breakdown && breakdown.maxTokens > 0 && breakdown.maxTokens < ctx.window
      ? breakdown.maxTokens
      : prev?.compactAt

  const next: Snapshot = {
    tokens,
    window: ctx.window,
    compactAt,
    percent: ctx.percent ?? (tokens !== undefined && ctx.window > 0 ? (tokens / ctx.window) * 100 : undefined),
    costUsd: usage.cost?.usd,
    limits: usage.rateLimits.map(r => ({
      kind: r.kind,
      percentUsed: r.percentUsed,
      resetsAt: r.resetsAt,
    })),
    categories: breakdown
      ? breakdown.categories
          .filter(c => c.kind === 'used' && c.tokens > 0)
          .map(c => ({ name: c.name, tokens: c.tokens }))
      : prev?.categories ?? [],
    lastDelta,
    history,
  }
  await update($, snap, () => next)
}

async function setMode($: EngineInterface, m: Mode) {
  const before = await read($, mode)
  await update($, mode, () => m)
  try {
    await $.store.set('mode', m)
  } catch {
    // the choice still applies to this session
  }
  try {
    if (showsPane(m)) {
      await $.ui.open({ id: PANE, title: 'Context' })
    } else if (showsPane(before)) {
      await $.ui.close({ id: PANE })
    }
  } catch {
    // a surface without panes: the band still works
  }
  await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    try {
      const saved = await $.store.get('mode')
      const m: Mode = MODES.includes(saved as Mode) ? (saved as Mode) : 'band'
      await update($, mode, () => m)
      await $.command.register({
        name: 'context-view',
        description: 'Show context usage as: band, pane, both, or off',
      })
      if (showsPane(m)) void $.ui.open({ id: PANE, title: 'Context' }).catch(() => {})
    } catch {
      // start with the defaults
    }
    await refresh($)
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    await refresh($)
    return ran
  })

  on('session.compact', async ($, e, next) => {
    const ran = await next(e)
    await refresh($)
    return ran
  })

  // The person closed the pane by hand: drop the pane from the mode.
  on('ui.close', async ($, e, next) => {
    const ran = await next(e)
    if (e.id === PANE && e.origin.kind === 'person') {
      try {
        const m = await read($, mode)
        const after: Mode = m === 'both' ? 'band' : m === 'pane' ? 'off' : m
        if (after !== m) {
          await update($, mode, () => after)
          await $.store.set('mode', after)
        }
      } catch {
        // the pane is closed either way
      }
    }
    return ran
  })

  on('command.run', { command: 'context-view' }, async ($, e) => {
    const asked = e.args.trim().toLowerCase()
    const current = await read($, mode)
    if (!asked) {
      // No argument: flip between band and pane.
      const flipped: Mode = current === 'band' ? 'pane' : 'band'
      await setMode($, flipped)
      return { text: `Context view: ${flipped}` }
    }
    const wanted = (asked === 'panel' || asked === 'side' ? 'pane' : asked) as Mode
    if (!MODES.includes(wanted)) {
      return { text: 'Use /context-view band, pane, both or off (no argument flips band and pane).' }
    }
    await setMode($, wanted)
    return { text: `Context view: ${wanted}` }
  })

  // ── Band: one quiet line above the prompt ──────────────────────────────
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const m = await read($, mode)
    const s = await read($, snap)
    if (!showsBand(m) || !s || e.props.hasSurvey) return next(e)

    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Svg = 'Svg' in els ? els.Svg : undefined
    const p = s.percent ?? 0
    const marker = s.compactAt ? (s.compactAt / s.window) * 100 : undefined
    const fiveHour = s.limits.find(l => l.kind === 'five_hour')
    const isHot = p >= 70

    return (
      <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap="md" paddingX="sm">
        <Box flexDirection="row" alignItems="center" gap="sm" flexShrink={1}>
          {Svg ? (
            <Svg source={barSvg(p, 56, 6, marker)} alt={`Context ${pct(p)} full`} width={56} height={6} />
          ) : (
            <Text color={tone(p)}>{textBar(p, 10)}</Text>
          )}
          <Text tabular weight="medium" color={isHot ? tone(p) : undefined}>
            {pct(p)}
          </Text>
          {s.tokens !== undefined && (
            <Text tabular dimColor>
              {k(s.tokens)} / {k(s.window)}
            </Text>
          )}
          {s.lastDelta !== undefined && s.lastDelta > 0 && (
            <Text tabular dimColor>
              · +{k(s.lastDelta)} last reply
            </Text>
          )}
          {fiveHour && (
            <Text tabular dimColor color={fiveHour.percentUsed >= 70 ? tone(fiveHour.percentUsed) : undefined}>
              · 5h {pct(fiveHour.percentUsed)}
            </Text>
          )}
          {s.costUsd !== undefined && (
            <Text tabular dimColor>
              · ${s.costUsd.toFixed(2)}
            </Text>
          )}
        </Box>
        <Box flexDirection="row" alignItems="center" gap="xs">
          <Button key="to-pane" plain dimColor label="Details" onPress={() => setMode($, 'pane')} />
          <Button key="hide" plain dimColor label="✕" onPress={() => setMode($, 'off')} />
        </Box>
      </Box>
    )
  })

  // ── Side panel ─────────────────────────────────────────────────────────
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Svg = 'Svg' in els ? els.Svg : undefined
    const m = await read($, mode)
    const s = await read($, snap)
    const now = await $.clock.now()
    const W = 260

    // An SVG where the surface draws one; a text bar in the terminal.
    // (`h` is the JSX factory, so the height is `tall` here.)
    const pic = (source: string, alt: string, wide: number, tall: number, fallback: string) =>
      Svg ? <Svg source={source} alt={alt} width={wide} height={tall} /> : <Text dimColor>{fallback}</Text>

    const section = (title: string, ...children: RenderChildren[]) => (
      <Box flexDirection="column" gap="xs">
        <Text size="footnote" weight="semibold" dimColor>
          {title.toUpperCase()}
        </Text>
        {children}
      </Box>
    )

    const switcher = (
      <Box flexDirection="row" alignItems="center" justifyContent="space-between">
        <Box flexDirection="row" gap="xs">
          <Button key="m-band" label="Band" variant={m === 'band' ? 'primary' : 'secondary'} onPress={() => setMode($, 'band')} />
          <Button key="m-pane" label="Panel" variant={m === 'pane' ? 'primary' : 'secondary'} onPress={() => setMode($, 'pane')} />
          <Button key="m-both" label="Both" variant={m === 'both' ? 'primary' : 'secondary'} onPress={() => setMode($, 'both')} />
        </Box>
        <Button key="m-refresh" plain dimColor label="↻" onPress={() => refresh($)} />
      </Box>
    )

    if (!s) {
      return (
        <Box flexDirection="column" gap="lg" padding="sm">
          <Text dimColor>Numbers appear after the next reply.</Text>
          {switcher}
        </Box>
      )
    }

    const p = s.percent ?? 0
    const marker = s.compactAt ? (s.compactAt / s.window) * 100 : undefined
    const left = repliesLeft(s)
    const used = s.categories.slice().sort((a, b) => b.tokens - a.tokens)
    const usedTotal = used.reduce((a, c) => a + c.tokens, 0)
    const colored = used.map((c, i) => ({ ...c, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length]! }))
    const spark = sparkSvg(s.history, s.compactAt ?? s.window, W, 44)

    return (
      <Box flexDirection="column" gap="lg" padding="sm">
        {/* Hero: ring + the numbers that matter */}
        <Box flexDirection="row" alignItems="center" gap="md">
          {Svg && <Svg source={ringSvg(p, 76, marker)} alt={`Context ${pct(p)} full`} width={76} height={76} />}
          <Box flexDirection="column" gap="xs">
            <Text size="title" weight="semibold" tabular color={p >= 70 ? tone(p) : undefined}>
              {pct(p)}
            </Text>
            {s.tokens !== undefined && (
              <Text tabular dimColor>
                {k(s.tokens)} of {k(s.window)} tokens
              </Text>
            )}
            {left !== undefined && (
              <Text tabular dimColor>
                ≈ {left} {left === 1 ? 'reply' : 'replies'} left{s.compactAt ? ' before compaction' : ''}
              </Text>
            )}
          </Box>
        </Box>

        {spark &&
          section(
            'Growth this session',
            pic(spark, 'Context size after each reply', W, 44, s.history.map(v => k(v)).slice(-8).join(' → ')),
            <Box flexDirection="row" justifyContent="space-between">
              <Text size="footnote" dimColor tabular>
                {s.history.length} replies
              </Text>
              {s.lastDelta !== undefined && (
                <Text size="footnote" dimColor tabular>
                  last {s.lastDelta >= 0 ? '+' : '−'}
                  {k(Math.abs(s.lastDelta))}
                </Text>
              )}
            </Box>,
          )}

        {colored.length > 0 &&
          section(
            "What's using it",
            Svg ? (
              <Svg
                source={stackSvg(colored, Math.max(usedTotal, 1), W, 10)}
                alt={colored.map(c => `${c.name} ${k(c.tokens)}`).join(', ')}
                width={W}
                height={10}
              />
            ) : null,
            ...colored.map(c => (
              <Box key={`c-${c.name}`} flexDirection="row" justifyContent="space-between" gap="sm">
                <Text>
                  <Text color={c.color}>● </Text>
                  {c.name}
                </Text>
                <Text tabular dimColor>
                  {k(c.tokens)}
                </Text>
              </Box>
            )),
          )}

        {s.limits.length > 0 &&
          section(
            'Plan usage',
            ...s.limits.map(l => (
              <Box key={`l-${l.kind}`} flexDirection="column" gap="xs">
                <Box flexDirection="row" justifyContent="space-between" gap="sm">
                  <Text>
                    {limitName(l.kind)} <Text tabular weight="medium">{pct(l.percentUsed)}</Text>
                  </Text>
                  <Text size="footnote" dimColor tabular>
                    {resetIn(l.resetsAt, now)}
                  </Text>
                </Box>
                {pic(barSvg(l.percentUsed, W, 6), `${limitName(l.kind)} limit ${pct(l.percentUsed)} used`, W, 6, textBar(l.percentUsed, 20))}
              </Box>
            )),
          )}

        {s.costUsd !== undefined &&
          section(
            'Session cost',
            <Text tabular weight="medium">
              ${s.costUsd.toFixed(2)}
            </Text>,
          )}

        {switcher}
      </Box>
    )
  })
}
