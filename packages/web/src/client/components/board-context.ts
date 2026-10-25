import {createContext} from "react";

/** Whether the board being rendered is the zoomed page (columns full width, big titles) or an inline strip. */
export const BoardZoomedContext = createContext(true);

export type BoardRowRole = "column" | "card";
