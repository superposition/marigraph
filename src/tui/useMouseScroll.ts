/**
 * Mouse Hook for Ink
 * Enables terminal mouse tracking for scroll, drag, and zoom
 */

import { useEffect, useRef, useState } from 'react'
import { useStdin, useStdout } from 'ink'

export interface ScrollEvent {
  direction: 'up' | 'down'
  x: number
  y: number
  shift: boolean
}

export interface DragEvent {
  deltaX: number
  deltaY: number
  x: number
  y: number
}

export interface MouseCallbacks {
  onScroll?: (event: ScrollEvent) => void
  onDrag?: (event: DragEvent) => void
}

// Global modifier state (shared across hook instances)
let modifierState = {
  shift: false,
  ctrl: false,
}

/**
 * Hook to detect mouse events in the terminal
 * - Scroll wheel for navigation (or zoom with shift/z key)
 * - Click and drag for rotation
 */
export function useMouseScroll(
  onScroll: (event: ScrollEvent) => void,
  enabled: boolean = true
): void {
  useMouse({ onScroll }, enabled)
}

export function useMouse(
  callbacks: MouseCallbacks,
  enabled: boolean = true
): void {
  const { stdin } = useStdin()
  const { stdout } = useStdout()
  const callbacksRef = useRef(callbacks)

  // Track mouse state for dragging
  const mouseState = useRef({
    isDown: false,
    lastX: 0,
    lastY: 0,
  })

  // Keep callbacks ref up to date
  useEffect(() => {
    callbacksRef.current = callbacks
  }, [callbacks])

  useEffect(() => {
    if (!enabled || !stdin || !stdout) return

    // Enable SGR mouse tracking (1006) with button events (1002) and motion (1003)
    const enableMouse = '\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h'
    const disableMouse = '\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l'

    stdout.write(enableMouse)

    // Buffer for partial escape sequences
    let buffer = ''

    const handleData = (data: Buffer) => {
      const str = buffer + data.toString()
      buffer = ''

      // Check for 'z' or 'Z' key to toggle zoom mode (alternative to shift)
      // This is processed before mouse events
      if (str.includes('z') || str.includes('Z')) {
        modifierState.shift = true
        // Reset after a short delay
        setTimeout(() => { modifierState.shift = false }, 300)
      }

      // Parse SGR mouse events: \x1b[<button;x;yM or \x1b[<button;x;ym
      // Button codes:
      // 0 = left click, 1 = middle, 2 = right
      // 32 = motion with left button down
      // 64 = scroll up, 65 = scroll down
      // +4 = shift modifier, +8 = meta, +16 = ctrl
      const sgrRegex = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g
      let match
      let lastIndex = 0

      while ((match = sgrRegex.exec(str)) !== null) {
        lastIndex = match.index + match[0].length
        const button = parseInt(match[1]!, 10)
        const x = parseInt(match[2]!, 10)
        const y = parseInt(match[3]!, 10)
        const isRelease = match[4] === 'm'

        // Extract modifiers from mouse event (shift=4, meta=8, ctrl=16)
        const mouseShift = (button & 4) !== 0
        const mouseCtrl = (button & 16) !== 0
        const baseButton = button & 3
        const isMotion = (button & 32) !== 0
        const isScroll = (button & 64) !== 0

        // Combine mouse modifiers with keyboard modifier state
        const hasModifier = mouseShift || mouseCtrl || modifierState.shift || modifierState.ctrl

        // Handle scroll wheel
        if (isScroll && !isRelease) {
          const direction = (button & 1) === 0 ? 'up' : 'down'
          callbacksRef.current.onScroll?.({ direction, x, y, shift: hasModifier })
        }
        // Handle mouse button press
        else if (baseButton === 0 && !isMotion) {
          if (!isRelease) {
            // Mouse down
            mouseState.current.isDown = true
            mouseState.current.lastX = x
            mouseState.current.lastY = y
          } else {
            // Mouse up
            mouseState.current.isDown = false
          }
        }
        // Handle mouse motion with button down (drag)
        else if (isMotion && mouseState.current.isDown) {
          const deltaX = x - mouseState.current.lastX
          const deltaY = y - mouseState.current.lastY

          if (deltaX !== 0 || deltaY !== 0) {
            callbacksRef.current.onDrag?.({ deltaX, deltaY, x, y })
            mouseState.current.lastX = x
            mouseState.current.lastY = y
          }
        }
      }

      // Keep any trailing partial escape sequence for next chunk
      const remaining = str.slice(lastIndex)
      if (remaining.includes('\x1b')) {
        buffer = remaining.slice(remaining.lastIndexOf('\x1b'))
      }
    }

    stdin.on('data', handleData)

    return () => {
      stdin.off('data', handleData)
      stdout.write(disableMouse)
    }
  }, [enabled, stdin, stdout])
}

export default useMouseScroll
