/**
 * IPC Protocol - Message types and flags
 */

export enum MessageType {
  // Control (0x00-0x0F)
  INIT = 0x00,
  READY = 0x01,
  SHUTDOWN = 0x02,
  PING = 0x03,
  PONG = 0x04,
  ERROR = 0x05,
  ACK = 0x06,

  // Data (0x10-0x1F)
  SURFACE_FULL = 0x10,
  SURFACE_DELTA = 0x11,
  CHAIN_FULL = 0x12,
  CHAIN_DELTA = 0x13,
  TIMESERIES = 0x14,
  DISPERSION = 0x15,

  // Widget (0x20-0x2F)
  SET_DATA = 0x20,
  APPEND_DATA = 0x21,
  CLEAR = 0x22,
  SCROLL = 0x23,
  FOCUS = 0x24,
  RESIZE = 0x25,
  SET_TITLE = 0x26,

  // Events - column → parent (0x30-0x3F)
  SELECTED = 0x30,
  CLICKED = 0x31,
  SUBMITTED = 0x32,
  KEY_PRESSED = 0x33,
  SCROLL_CHANGED = 0x34,

  // Render (0x40-0x4F)
  RENDER_REQUEST = 0x40,
  RENDER_RESULT = 0x41,

  // Config (0x50-0x5F)
  CONFIG_UPDATE = 0x50,
  WIRING_UPDATE = 0x51,
}

export enum MessageFlag {
  NONE = 0x00,
  COMPRESSED = 0x01, // payload is compressed
  REQUEST = 0x02, // expects response (use seq for matching)
  RESPONSE = 0x04, // response to a request
  BROADCAST = 0x08, // send to all columns
}

// Frame header structure (8 bytes)
export interface FrameHeader {
  length: number // u32 - payload length
  type: MessageType // u8
  flags: number // u8
  seq: number // u16 - sequence number for request/response
}

export const FRAME_HEADER_SIZE = 8

// Message targets
export type MessageTarget =
  | string // specific column id
  | '*' // broadcast to all
  | string[] // multiple specific columns

// Full message structure
export interface IPCMessage<T = unknown> {
  header: FrameHeader
  payload: T
}

// Control messages
export interface InitMessage {
  columnId: string
  config: Record<string, unknown>
}

export interface ReadyMessage {
  columnId: string
}

export interface ShutdownMessage {
  reason?: string
}

export interface ErrorMessage {
  code: number
  message: string
  columnId?: string
}

// Data messages
export interface SurfaceFullMessage {
  nx: number
  ny: number
  x: Float32Array
  y: Float32Array
  z: Float32Array
  meta: {
    xLabel: string
    yLabel: string
    zLabel: string
    xDomain: [number, number]
    yDomain: [number, number]
    zDomain: [number, number]
  }
}

export interface SurfaceDeltaMessage {
  indices: Uint32Array // flat indices that changed
  values: Float32Array // new values
}

// Widget messages
export interface SetDataMessage {
  target: MessageTarget
  data: unknown
}

export interface AppendDataMessage {
  target: MessageTarget
  data: unknown
}

// Event messages
export interface SelectedMessage {
  columnId: string
  index: number
  value: unknown
}

export interface ClickedMessage {
  columnId: string
  x: number
  y: number
  value?: unknown
}

export interface KeyPressedMessage {
  columnId: string
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
}
