/**
 * Scrollable List Widget
 * Displays a selectable list with keyboard navigation
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'

export interface ListItem {
  id: string
  label: string
  value?: unknown
  disabled?: boolean
}

export interface ListWidgetProps {
  /** List items to display */
  items: ListItem[]
  /** Currently selected index */
  selectedIndex?: number
  /** Called when selection changes */
  onSelect?: (item: ListItem, index: number) => void
  /** Called when item is activated (Enter) */
  onActivate?: (item: ListItem, index: number) => void
  /** Widget title */
  title?: string
  /** Max visible items (scrolls if more) */
  maxVisible?: number
  /** Enable keyboard navigation */
  enableInput?: boolean
  /** Show item indices */
  showIndices?: boolean
  /** Custom item renderer */
  renderItem?: (item: ListItem, selected: boolean, index: number) => React.ReactNode
}

export function ListWidget({
  items,
  selectedIndex: controlledIndex,
  onSelect,
  onActivate,
  title,
  maxVisible = 10,
  enableInput = true,
  showIndices = false,
  renderItem,
}: ListWidgetProps): React.ReactElement {
  const [internalIndex, setInternalIndex] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)

  // Use controlled or internal index
  const selectedIndex = controlledIndex ?? internalIndex

  // Update scroll offset when selection changes
  useEffect(() => {
    if (selectedIndex < scrollOffset) {
      setScrollOffset(selectedIndex)
    } else if (selectedIndex >= scrollOffset + maxVisible) {
      setScrollOffset(selectedIndex - maxVisible + 1)
    }
  }, [selectedIndex, scrollOffset, maxVisible])

  // Handle keyboard input
  useInput(
    (input, key) => {
      if (!enableInput || items.length === 0) return

      let newIndex = selectedIndex

      if (key.upArrow || input === 'k') {
        newIndex = Math.max(0, selectedIndex - 1)
      } else if (key.downArrow || input === 'j') {
        newIndex = Math.min(items.length - 1, selectedIndex + 1)
      } else if (key.pageUp) {
        newIndex = Math.max(0, selectedIndex - maxVisible)
      } else if (key.pageDown) {
        newIndex = Math.min(items.length - 1, selectedIndex + maxVisible)
      } else if (input === 'g') {
        newIndex = 0
      } else if (input === 'G') {
        newIndex = items.length - 1
      } else if (key.return) {
        const item = items[selectedIndex]
        if (item && !item.disabled && onActivate) {
          onActivate(item, selectedIndex)
        }
        return
      }

      if (newIndex !== selectedIndex) {
        setInternalIndex(newIndex)
        const item = items[newIndex]
        if (item && onSelect) {
          onSelect(item, newIndex)
        }
      }
    },
    { isActive: enableInput }
  )

  // Visible items based on scroll
  const visibleItems = items.slice(scrollOffset, scrollOffset + maxVisible)
  const hasScrollUp = scrollOffset > 0
  const hasScrollDown = scrollOffset + maxVisible < items.length

  // Default item renderer
  const defaultRenderItem = (item: ListItem, selected: boolean, index: number) => {
    const prefix = showIndices ? `${index + 1}. ` : ''
    const selector = selected ? '>' : ' '

    return (
      <Text
        color={item.disabled ? 'gray' : selected ? 'cyan' : undefined}
        dimColor={item.disabled}
        bold={selected}
      >
        {selector} {prefix}
        {item.label}
      </Text>
    )
  }

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      {/* Header */}
      {title && (
        <Box justifyContent="space-between">
          <Text bold>{title}</Text>
          <Text dimColor>
            {items.length > 0 ? `${selectedIndex + 1}/${items.length}` : '0/0'}
          </Text>
        </Box>
      )}

      {/* Scroll up indicator */}
      {hasScrollUp && (
        <Text dimColor>  ↑ more</Text>
      )}

      {/* List items */}
      {visibleItems.length === 0 ? (
        <Text dimColor>No items</Text>
      ) : (
        visibleItems.map((item, i) => {
          const actualIndex = scrollOffset + i
          const selected = actualIndex === selectedIndex
          const renderer = renderItem || defaultRenderItem

          return (
            <Box key={item.id}>
              {renderer(item, selected, actualIndex)}
            </Box>
          )
        })
      )}

      {/* Scroll down indicator */}
      {hasScrollDown && (
        <Text dimColor>  ↓ more</Text>
      )}

      {/* Help text */}
      {enableInput && items.length > 0 && (
        <Text dimColor>↑↓ navigate, Enter select</Text>
      )}
    </Box>
  )
}

export default ListWidget
