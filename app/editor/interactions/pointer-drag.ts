/** A click can jitter a little without becoming an edit, at any canvas zoom. */
export const DRAG_SCREEN_DISTANCE = 4;
export type DragIntent = { startClient: { x: number; y: number }; started: boolean };
type ClientPoint = { clientX: number; clientY: number };
export function dragIntent(event: ClientPoint): DragIntent {
  return { startClient: { x: event.clientX, y: event.clientY }, started: false };
}
export function passedDragThreshold(drag: DragIntent, event: ClientPoint) {
  return Math.hypot(event.clientX - drag.startClient.x, event.clientY - drag.startClient.y) >= DRAG_SCREEN_DISTANCE;
}
