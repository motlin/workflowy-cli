import type {SearchOperator} from "../query-nodes.js";
import * as dates from "./dates.js";
import * as meta from "./meta.js";
import * as time from "./time.js";

/**
 * Search operators in upstream insertion order (WF.map.SearchQueryNode): the first whose `matchesToken`
 * accepts a token wins. Collaboration-only operators (is:shared, @:me, mentioned:, has:file, ...) are never registered.
 */
export const SEARCH_OPERATORS: SearchOperator[] = [
	meta.isComplete,
	meta.isIncomplete,
	meta.isMirror,
	meta.isBacklink,
	meta.isTodo,
	meta.isDivider,
	meta.hasNote,
	meta.hasChildren,
	time.changed,
	time.changedBefore,
	time.created,
	time.completed,
	time.changedBy,
	dates.past,
	dates.future,
	dates.on,
	dates.before,
	dates.after,
	dates.bareDate,
	dates.dayOfWeek,
	meta.textBold,
	meta.textItalic,
	meta.textUnderline,
	meta.textStrikethrough,
	meta.link,
	meta.isH1,
	meta.textH2,
	meta.textH3,
	meta.isParagraph,
	meta.id,
	meta.hasDate,
	meta.textCode,
	meta.textColored,
	meta.textHighlighted,
	meta.textColor,
	meta.highlightColor,
	meta.isCodeBlock,
	meta.isQuote,
	meta.inNote,
	meta.inBacklink,
];
