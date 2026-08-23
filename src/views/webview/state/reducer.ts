import type { NavigatorViewModel } from "../../../shared/types";

export interface AppState {
  viewModel: NavigatorViewModel | null;
  operationError?: string;
  operationErrorRevision: number;
}

export type Action =
  | { type: "UPDATE_VIEW_MODEL"; payload: NavigatorViewModel }
  | { type: "SET_OPERATION_ERROR"; message: string };

export const initialState: AppState = { viewModel: null, operationErrorRevision: 0 };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "UPDATE_VIEW_MODEL":
      return { ...state, viewModel: action.payload };
    case "SET_OPERATION_ERROR":
      return {
        ...state,
        operationError: action.message,
        operationErrorRevision: state.operationErrorRevision + 1
      };
    default:
      return state;
  }
}
