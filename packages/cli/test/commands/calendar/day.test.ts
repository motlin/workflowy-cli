import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {captureOutput} from "@oclif/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import CalendarDay from "../../../src/commands/calendar/day.js";
import {cleanupTestDatabase, createTestDatabase} from "../../db/migration-helper.js";
import type {TestDatabase} from "../../db/migration-helper.js";
import {seedTaggedCalendar} from "../../helpers/calendar-fixture.js";

describe("calendar day command", () => {
	let originalEnv: typeof process.env;
	let tempDir: string;
	let testDatabase: TestDatabase;

	beforeEach(() => {
		originalEnv = {...process.env};
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflowy-calendar-day-test-"));
		const testDbPath = path.join(tempDir, "test.sqlite");
		testDatabase = createTestDatabase(testDbPath);
		process.env.WORKFLOWY_DB_PATH = testDbPath;
		seedTaggedCalendar(testDatabase);
	});

	afterEach(() => {
		process.env = originalEnv;
		cleanupTestDatabase(testDatabase);
		fs.rmSync(tempDir, {recursive: true, force: true});
	});

	it("prints the tagged day's id and first child as JSON", async () => {
		const {stdout} = await captureOutput(async () => {
			await CalendarDay.run(["--date", "2026-10-05", "--json"]);
		});

		expect(JSON.parse(stdout)).toStrictEqual({id: "d1005", firstChildId: "c1"});
	});

	it("exits 1 for a name-only day, which workflowy.com does not see either", async () => {
		const {error} = await captureOutput(async () => {
			await CalendarDay.run(["--date", "2026-10-06"]);
		});

		expect({
			message: error?.message,
			code: (error as {oclif?: {exit?: number}} | undefined)?.oclif?.exit,
		}).toStrictEqual({
			message: "No 📆 Calendar day for 2026-10-06",
			code: 1,
		});
	});

	it("prints the short id in text mode", async () => {
		const {stdout} = await captureOutput(async () => {
			await CalendarDay.run(["--date", "2026-10-05"]);
		});

		expect(stdout).toBe("d1005\n");
	});
});
