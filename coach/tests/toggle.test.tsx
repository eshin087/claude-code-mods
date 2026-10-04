// Coach: the dock's Coach button toggles the pane. `claude plugin test` here.
import { expect, test } from 'claude-code/testing'
import type { On, Register } from 'claude-code'

// A stand-in for the dock: a prompt "press:<mod>" writes the dock's signal.
const DOCK: { name: string; register: Register } = {
  name: 'mod-hub',
  register: on => {
    on('prompt.submit', async ($, e, next) => {
      if (e.text === 'review') {
        const cur = (await $.state.get({ plugin: 'mod-hub', key: 'signal' })).value
        await $.state.set({ plugin: 'mod-hub', key: 'signal' }, { seq: (cur?.seq ?? 0) + 1, target: '*', action: 'review' })
        return { text: e.text }
      }
      if (!e.text.startsWith('press:')) return next(e)
      const cur = (await $.state.get({ plugin: 'mod-hub', key: 'signal' })).value
      await $.state.set({ plugin: 'mod-hub', key: 'signal' }, { seq: (cur?.seq ?? 0) + 1, target: e.text.slice(6) })
      return { text: e.text }
    })
  },
}

const PROBE: { name: string; register: Register } = {
  name: 'probe',
  register: on => {
    on('tool.call', { tool: 'mcp__probe__read' }, async $ => ({
      result: {
        isOpen: (await $.state.get({ plugin: 'coach', key: 'isOpen' })).value ?? false,
        unseen: (await $.state.get({ plugin: 'coach', key: 'unseen' })).value ?? false,
      },
    }))
  },
}

const world = (on: On) => {
  const panes = new Set<string>()
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: 'C:/x/gcdAtlas' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.panes', () => ({ value: [...panes].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.open', ($, e) => {
    panes.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    panes.delete(e.id)
    return { value: undefined }
  })
  return panes
}

test('1. Coach: a dock press opens the coach pane, a second press closes it', { plugins: [DOCK, PROBE] }, async ($, on) => {
  const panes = world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  const press = () => $.prompt.submit({ text: 'press:coach', wait: false, origin: { kind: 'composer' } } as never)
  const peek = async () => (await $.tool.call({ tool: 'mcp__probe__read' } as never)).result as { isOpen: boolean; unseen: boolean }

  await press()
  expect(panes.has('coach')).toBe(true)
  expect((await peek()).isOpen).toBe(true)
  await press()
  expect(panes.has('coach')).toBe(false)
  expect((await peek()).isOpen).toBe(false)
})

test('1b. a press meant for another mod leaves the coach alone', { plugins: [DOCK, PROBE] }, async ($, on) => {
  const panes = world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'press:pr-desk', wait: false, origin: { kind: 'composer' } } as never)
  expect(panes.has('coach')).toBe(false)
})

test('review opens the coach pane and never closes it', { plugins: [DOCK, PROBE] }, async ($, on) => {
  const panes = world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  const review = () => $.prompt.submit({ text: 'review', wait: false, origin: { kind: 'composer' } } as never)
  await review()
  expect(panes.has('coach')).toBe(true)
  await review()
  expect(panes.has('coach')).toBe(true)
})

// The panel at a glance: metrics, habits and one "Do next"; the rest behind More.
test('the coach panel shows metrics, habits, do next and the lesson; More adds try-next and the pro tip', async ($, on) => {
  world(on)
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'coach',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'coach',
    props: { title: 'Coach', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  })
  const text = async () => JSON.stringify(await ui.drawn())
  expect(await text()).toMatch(/Cache/)
  expect(await text()).toMatch(/Context/)
  expect(await text()).toMatch(/Habits/)
  expect(await text()).toMatch(/Do next/)
  expect(await text()).toMatch(/Lesson/)
  expect(await text()).not.toMatch(/Pro tip/)
  expect(await text()).not.toMatch(/Try:/)
  await ui.press({ key: 'more' })
  expect(await text()).toMatch(/Try:/)
  expect(await text()).toMatch(/Pro tip/)
})
