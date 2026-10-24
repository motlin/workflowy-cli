import {describe, expect, it} from "vite-plus/test";
import {renderEditorHtml, serializeEditorHtml} from "../src/client/editor-html.js";

const settings = {dateFormat: "YYYY-MM-DD ddd", timeFormat: "HH:mm", weekStartDay: 0};
const account = {userId: 7, fullName: "Alice Smith"};

describe("mentions in names", () => {
	it.each([
		'MP date <mention id="0" by="1" ts="1"> </mention> <time startYear="2026" startMonth="10" startDay="23">Fri, Oct 23, 2026</time> z',
		'MP bold <b>p <mention id="0" by="1" ts="1"> </mention> q</b> r',
		'<mention id="7" by="7" ts="5"> </mention>',
	])("round-trips %s", (stored) => {
		expect(serializeEditorHtml(renderEditorHtml(stored, settings, account))).toBe(stored);
	});

	it("renders the resolved name as a pill", () => {
		const html = renderEditorHtml('a <mention id="7" by="7" ts="5"> </mention> b', settings, account);
		expect(html).toContain("mention-of-current-user");
		expect(html).toContain("Alice Smith");
	});

	it("repairs a corrupted raw mention on serialize", () => {
		expect(serializeEditorHtml('x <mention id="7" by="7" ts="5"> Q</mention> y')).toBe(
			'x <mention id="7" by="7" ts="5"> </mention> y',
		);
	});
});
