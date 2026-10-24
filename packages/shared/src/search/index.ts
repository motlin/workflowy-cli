export {buildSearchConditions, getScoringTerms, type SearchConditions} from "./conditions.js";
export {normalizeForSearch, normalizeWithOffsets} from "./normalize.js";
export {
	matchNested,
	type MatchResult,
	type NestedQuery,
	parseNestedQuery,
	type OperatorContext,
	parseQuery,
	type ParseQueryOptions,
	type QueryNode,
	SEARCH_OPERATORS,
	type SearchItem,
	type SearchOperator,
} from "./query-ast.js";
export {type ParsedQuery, parseSearchQuery} from "./query-parser.js";
export {
	type FieldMatch,
	matchField,
	matchSwitcherRow,
	splitIntoWords,
	type SwitcherRowInput,
	type SwitcherRowMatch,
} from "./switcher-match.js";
export {
	resolveJoinedSec,
	type ResolveJoinedSecInput,
	staticScore,
	type StaticScoreInput,
	textFactor,
} from "./switcher-rank.js";
