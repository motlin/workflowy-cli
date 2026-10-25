import {createContext} from "react";

/**
 * Upstream `WF.Layouts.canRender`: true below a table or board being rendered. A table met in there is a plain
 * list, never a nested table (upstream's `complex` layouts).
 */
export const InComplexLayoutContext = createContext(false);
