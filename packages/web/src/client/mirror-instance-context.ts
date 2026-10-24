import {createContext} from "react";
import type {MirrorInstance} from "../mirror-path.js";

/** The mirror instance the enclosing `.children` renders in; null outside any mirror. */
export const MirrorInstanceContext = createContext<MirrorInstance | null>(null);
