/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { TextareaRenderable } from "@opentui/core"
import { ManualClock } from "@opentui/core/testing"
import { testRender } from "@opentui/solid"
import { createPointerSelection, MULTI_CLICK_INTERVAL_MS } from "../../src/component/prompt/pointer-selection"

async function fixture(enabled = true) {
  const clock = new ManualClock()
  const clicks: number[] = []
  const refs: { input?: TextareaRenderable } = {}
  const app = await testRender(
    () => (
      <textarea
        width={30}
        height={3}
        focused
        initialValue="hello world again"
        ref={(input: TextareaRenderable) => {
          refs.input = input
        }}
      />
    ),
    { width: 40, height: 5, clock, kittyKeyboard: true },
  )
  await app.renderOnce()
  const input = refs.input!
  const pointer = createPointerSelection(input, {
    clock,
    enabled: () => enabled,
    onClick: () => clicks.push(input.cursorOffset),
  })
  input.cursorOffset = 0
  return { app, clock, input, pointer, clicks, [Symbol.dispose]: () => app.renderer.destroy() }
}

test("a mouse drag selects text without moving the cursor", async () => {
  using setup = await fixture()

  await setup.app.mockMouse.drag(6, 0, 10, 0)

  expect(setup.input.getSelectedText()).toBe("world")
  expect(setup.pointer.selected()).toBe(true)
  expect(setup.input.cursorOffset).toBe(0)
  setup.clock.advance(MULTI_CLICK_INTERVAL_MS + 1)
  expect(setup.input.cursorOffset).toBe(0)
  expect(setup.clicks).toEqual([])
})

test("a single click places the cursor once it can no longer become a double click", async () => {
  using setup = await fixture()

  await setup.app.mockMouse.click(6, 0)
  expect(setup.input.cursorOffset).toBe(0)
  setup.clock.advance(MULTI_CLICK_INTERVAL_MS - 1)
  expect(setup.input.cursorOffset).toBe(0)
  setup.clock.advance(1)

  expect(setup.input.cursorOffset).toBe(6)
  expect(setup.clicks).toEqual([6])
  expect(setup.pointer.selected()).toBe(false)
})

test("a double click selects a word and never places the cursor", async () => {
  using setup = await fixture()

  await setup.app.mockMouse.click(7, 0)
  await setup.app.mockMouse.click(7, 0)
  setup.clock.advance(MULTI_CLICK_INTERVAL_MS + 1)

  expect(setup.input.getSelectedText()).toBe("world")
  expect(setup.pointer.selected()).toBe(true)
  expect(setup.input.cursorOffset).toBe(0)
  expect(setup.clicks).toEqual([])
})

test("flush places a pending click at once", async () => {
  using setup = await fixture()

  await setup.app.mockMouse.click(12, 0)
  setup.pointer.flush()

  expect(setup.input.cursorOffset).toBe(12)
  expect(setup.clicks).toEqual([12])
  setup.clock.advance(MULTI_CLICK_INTERVAL_MS + 1)
  expect(setup.clicks).toEqual([12])
})

test("keyboard selection still moves the cursor", async () => {
  using setup = await fixture()

  setup.app.mockInput.pressArrow("right", { shift: true })
  setup.app.mockInput.pressArrow("right", { shift: true })

  expect(setup.input.hasSelection()).toBe(true)
  expect(setup.input.cursorOffset).toBe(2)
  expect(setup.pointer.selected()).toBe(false)
})

test("the mouse moves the cursor as before when disabled", async () => {
  using setup = await fixture(false)

  await setup.app.mockMouse.click(6, 0)
  expect(setup.input.cursorOffset).toBe(6)

  setup.app.renderer.clearSelection()
  await setup.app.mockMouse.drag(12, 0, 16, 0)
  expect(setup.input.getSelectedText()).toBe("again")
  expect(setup.input.cursorOffset).toBe(16)
  expect(setup.pointer.selected()).toBe(false)
  setup.clock.advance(MULTI_CLICK_INTERVAL_MS + 1)
  expect(setup.clicks).toEqual([])
})
