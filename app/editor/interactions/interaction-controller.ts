export type InteractionMode =
  | "idle"
  | "select"
  | "draw"
  | "edit"
  | "pan"
  | "resize"
  | "rotate"
  | "model";

export type InteractionState = {
  mode: InteractionMode;
  pointerId: number | null;
  annotationId: string | null;
  vertexId: string | null;
};

const initialState: InteractionState = {
  mode: "idle",
  pointerId: null,
  annotationId: null,
  vertexId: null,
};

/**
 * Small explicit state machine for editor gestures. It prevents overlapping drag/draw/pan
 * sessions and gives future tools one place to acquire/release pointer ownership.
 */
export class InteractionController {
  private state: InteractionState = { ...initialState };

  snapshot(): InteractionState {
    return { ...this.state };
  }

  begin(
    mode: Exclude<InteractionMode, "idle">,
    options: Partial<Pick<InteractionState, "pointerId" | "annotationId" | "vertexId">> = {},
  ) {
    if (this.state.mode !== "idle") return false;
    this.state = {
      mode,
      pointerId: options.pointerId ?? null,
      annotationId: options.annotationId ?? null,
      vertexId: options.vertexId ?? null,
    };
    return true;
  }

  owns(pointerId: number | null | undefined) {
    return this.state.pointerId === null || pointerId == null || this.state.pointerId === pointerId;
  }

  is(mode: InteractionMode) {
    return this.state.mode === mode;
  }

  finish(pointerId?: number | null) {
    if (!this.owns(pointerId)) return false;
    this.state = { ...initialState };
    return true;
  }

  cancel() {
    this.state = { ...initialState };
  }
}
