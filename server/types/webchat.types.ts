/**
 * Webchat widget configuration types
 *
 * Lightweight module (no TypeORM/runtime deps) so it can be imported by both
 * the server and the dashboard. The entity re-exports these for persistence.
 */

export enum WebchatPosition {
  LEFT = "left",
  RIGHT = "right",
}

export enum WebchatTheme {
  BLUE = "blue",
  GREEN = "green",
  PURPLE = "purple",
  BLACK = "black",
}
