import type { NavigatorViewModel } from "../../../shared/types";

export interface AppState {
  viewModel: NavigatorViewModel | null;
}

export type Action = { type: "UPDATE_VIEW_MODEL"; payload: NavigatorViewModel };

export const initialState: AppState = { viewModel: null };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "UPDATE_VIEW_MODEL":
      return { viewModel: action.payload };
    default:
      return state;
  }
}
