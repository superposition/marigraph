/**
 * Configuration module exports
 */

export {
  validateTemplate,
  DEFAULT_TEMPLATE,
} from './types.ts'
export type {
  WidgetType,
  ColumnPosition,
  ColumnConfig,
  EventWiring,
  DataSourceConfig,
  LayoutConfig,
  SixcolTemplate,
  ColumnState,
} from './types.ts'

export {
  loadTemplate,
  loadTemplateFromString,
  mergeWithDefaults,
  resolveLayout,
  buildWiringMap,
  getWiredTargets,
  generateExampleTemplate,
  getRiskOracleTemplate,
} from './loader.ts'
