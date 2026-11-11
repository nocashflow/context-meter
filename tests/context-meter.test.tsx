// Tests! These pretend to be Claude Code, feed the mod fake usage numbers,
// and check it draws the right things. Run them with: claude plugin test .

import { expect, test } from 'claude-code/testing'

function usage(tokens: number) {
  return {
    startedAt: 0,
    context: {
      tokens,
      window: 200_000,
      percent: (tokens / 200_000) * 100,
      breakdown: {
        categories: [
          { name: 'Messages', tokens: tokens - 20_000, color: 'text', isDeferred: false, kind: 'used' },
          { name: 'System tools', tokens: 20_000, color: 'text', isDeferred: false, kind: 'used' },
          { name: 'Free space', tokens: 200_000 - tokens, color: 'text', isDeferred: false, kind: 'free' },
        ],
        totalTokens: tokens,
        maxTokens: 160_000,
        rawMaxTokens: 200_000,
        autocompactSource: 'model-default',
      },
    },
    rateLimits: [{ kind: 'five_hour', percentUsed: 31 }],
    cost: { usd: 1.84 },
  }
}

const TURN = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

const BAND = {
  plugin: 'context-meter',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false },
} as const

const PANE = {
  plugin: 'context-meter',
  component: 'Pane',
  requestId: 'context-meter',
  props: {
    title: 'Context',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

function engine(on: any, store: Map<string, unknown>, readings: number[]) {
  let i = 0
  on('command.register', () => ({ value: { command: 'context-view' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.usage', () => ({ value: usage(readings[Math.min(i++, readings.length - 1)]!) }))
  on('clock.now', () => ({ value: 0 }))
  on('store.get', (_: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
}

test('band shows context, last-reply growth, 5h limit and cost, and opens the panel', async ($, on) => {
  const store = new Map<string, unknown>()
  engine(on, store, [80_000, 92_000])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(TURN)

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await band.find({ type: 'Text', text: /^46%$/ }))?.text).toBe('46%')
  expect((await band.find({ type: 'Text', text: /200k/ }))?.text).toBe('92k / 200k')
  expect((await band.find({ type: 'Text', text: /last reply/ }))?.text).toBe('· +12k last reply')
  expect((await band.find({ type: 'Text', text: /5h/ }))?.text).toBe('· 5h 31%')
  expect((await band.find({ type: 'Text', text: /\$/ }))?.text).toBe('· $1.84')

  await band.press({ key: 'to-pane' })
  expect(store.get('mode')).toBe('pane')
  await band.unmount()
})

test('panel shows ring numbers, replies left, breakdown and limits', async ($, on) => {
  const store = new Map<string, unknown>([['mode', 'pane']])
  engine(on, store, [60_000, 70_000, 80_000, 90_000])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(TURN)
  await $.turn.complete(TURN)
  await $.turn.complete(TURN)

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await pane.find({ type: 'Text', text: /^45%$/ }))?.text).toBe('45%')
  // Quick maths: (160k compact point - 90k used) / 10k per reply = 7 left
  expect((await pane.find({ type: 'Text', text: /replies left/ }))?.text).toBe('≈ 7 replies left before compaction')
  expect(await pane.find({ type: 'Text', text: /Messages/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Free space/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /5-hour/ })).toBeDefined()
  await pane.unmount()
})

test('band hides itself in pane mode', async ($, on) => {
  const store = new Map<string, unknown>([['mode', 'pane']])
  engine(on, store, [92_000])
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await band.find({ type: 'Text' }))?.text).toBe('engine')
  await band.unmount()
})

test('terminal, VS Code and mobile draw both views without error', async ($, on) => {
  const store = new Map<string, unknown>([['mode', 'both']])
  engine(on, store, [60_000, 70_000, 80_000])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(TURN)
  await $.turn.complete(TURN)

  for (const surface of ['terminal', 'vscode', 'mobile'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect((await band.find({ type: 'Text', text: /^40%$/ }))?.text).toBe('40%')
    await band.unmount()
    const pane = await $.ui.mount({ ...PANE, surface })
    expect((await pane.find({ type: 'Text', text: /^40%$/ }))?.text).toBe('40%')
    await pane.unmount()
  }
})
