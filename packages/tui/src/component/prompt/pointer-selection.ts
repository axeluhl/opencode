import type { Clock, TextareaRenderable, TimerHandle } from "@opentui/core"

// OpenTUI turns a click within this interval of the previous one into a word or line selection and does not export
// the value. A single click places the cursor only once it can no longer become a double click.
export const MULTI_CLICK_INTERVAL_MS = 500

// Keeps mouse selections in the prompt from moving its cursor, as with a terminal selection made for middle-click
// paste. Callers drop the selection before typing or pasting so the input lands at the cursor instead of replacing it.
export function createPointerSelection(
  input: TextareaRenderable,
  options: { clock: Clock; enabled: () => boolean; onClick: () => void },
) {
  const view = input.editorView
  const setLocalSelection = view.setLocalSelection.bind(view)
  const updateLocalSelection = view.updateLocalSelection.bind(view)
  const resetLocalSelection = view.resetLocalSelection.bind(view)
  const onSelectionChanged = input.onSelectionChanged.bind(input)
  const state: {
    selected: boolean
    pointer?: { x: number; y: number; moved: boolean }
    click?: { x: number; y: number }
    timer?: TimerHandle
  } = { selected: false }

  // OpenTUI asks the view to move the cursor on every selection change, and to follow it only while the keyboard
  // selects, so a cursor update without follow comes from the mouse.
  const track = (
    anchorX: number,
    anchorY: number,
    focusX: number,
    focusY: number,
    updateCursor?: boolean,
    followCursor?: boolean,
  ) => {
    if (!updateCursor || followCursor || !options.enabled()) return updateCursor
    state.pointer = { x: anchorX, y: anchorY, moved: anchorX !== focusX || anchorY !== focusY }
    return false
  }
  view.setLocalSelection = (anchorX, anchorY, focusX, focusY, bgColor, fgColor, updateCursor, followCursor, behavior) =>
    setLocalSelection(
      anchorX,
      anchorY,
      focusX,
      focusY,
      bgColor,
      fgColor,
      track(anchorX, anchorY, focusX, focusY, updateCursor, followCursor),
      followCursor,
      behavior,
    )
  view.updateLocalSelection = (
    anchorX,
    anchorY,
    focusX,
    focusY,
    bgColor,
    fgColor,
    updateCursor,
    followCursor,
    behavior,
  ) =>
    updateLocalSelection(
      anchorX,
      anchorY,
      focusX,
      focusY,
      bgColor,
      fgColor,
      track(anchorX, anchorY, focusX, focusY, updateCursor, followCursor),
      followCursor,
      behavior,
    )

  input.onSelectionChanged = (selection) => {
    takePointer()
    const selected = onSelectionChanged(selection)
    const pointer = takePointer()
    state.selected = selected && pointer !== undefined
    if (!selection || !pointer) return selected
    if (pointer.moved || selection.behavior !== "cell") cancel()
    else if (selection.isStart && selection.isDragging) {
      stop()
      state.click = { x: pointer.x, y: pointer.y }
    } else if (!selection.isDragging && state.click) {
      stop()
      state.timer = options.clock.setTimeout(place, MULTI_CLICK_INTERVAL_MS)
    }
    return selected
  }

  function takePointer() {
    const pointer = state.pointer
    state.pointer = undefined
    return pointer
  }

  function place() {
    stop()
    const click = state.click
    state.click = undefined
    if (!click || input.isDestroyed) return
    // The view already holds this empty selection without a cursor update; resetting it makes the view apply one.
    resetLocalSelection()
    setLocalSelection(click.x, click.y, click.x, click.y, undefined, undefined, true, false, "cell")
    input.requestRender()
    options.onClick()
  }

  function cancel() {
    stop()
    state.click = undefined
  }

  function stop() {
    if (state.timer !== undefined) options.clock.clearTimeout(state.timer)
    state.timer = undefined
  }

  return {
    /** Whether the prompt holds a selection made with the mouse. */
    selected: () => state.selected && input.hasSelection(),
    /** Places the cursor for a pending single click now, before input that depends on its position. */
    flush: () => {
      if (state.click) place()
    },
    dispose: stop,
  }
}

export type PointerSelection = ReturnType<typeof createPointerSelection>
