import {useEffect, useRef, useState} from "react";
import type {KeyboardEvent} from "react";
import {useHotkeys} from "react-hotkeys-hook";
import {formatPillLabel} from "@workflowy/shared";
import {dateFormatOptions, timeFormatOptions, weekStartPatch} from "../date-settings.js";
import type {FormatOption} from "../date-settings.js";
import {usePreferences} from "../hooks/use-preferences.js";
import type {PreferencesPatch} from "../hooks/use-preferences.js";
import {useOutlineStore} from "../stores/outline.js";
import type {Theme} from "../stores/outline.js";

const MOMENT_FORMAT_DOCS = "https://momentjscom.readthedocs.io/en/latest/moment/04-displaying/01-format/";

/** The options, plus the current value rendered in itself when it is a custom format. */
function withCurrent(options: FormatOption[], current: string, label: () => string): FormatOption[] {
	return options.some((option) => option.value === current)
		? options
		: [{value: current, label: label()}, ...options];
}

interface CustomFormatInputProps {
	ariaLabel: string;
	className: string;
	disabled: boolean;
	id: string;
	value: string;
	onSave: (value: string) => void;
}

/** A text field holding a draft that is saved on blur or Enter, only when it changed. Key it by `value` to reset the draft. */
function CustomFormatInput({ariaLabel, className, disabled, id, value, onSave}: CustomFormatInputProps) {
	const [draft, setDraft] = useState(value);
	const save = () => {
		const next = draft.trim();
		if (next !== "" && next !== value) {
			onSave(next);
		}
	};
	return (
		<input
			aria-label={ariaLabel}
			className={`settings-input ${className}`}
			disabled={disabled}
			id={id}
			onBlur={save}
			onChange={(event) => {
				setDraft(event.target.value);
			}}
			onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
				if (event.key === "Enter") {
					save();
				}
			}}
			type="text"
			value={draft}
		/>
	);
}

/**
 * Settings > Dates: date format, time format, start of week and custom formats,
 * stored in the account's root metadata through `/api/v1/preferences`.
 */
export function DatesSection({now: nowProp}: {now?: Date}) {
	const [openedAt] = useState(() => new Date());
	const now = nowProp ?? openedAt;
	const {available, error, dateSettings, setPreferences} = usePreferences();
	const {dateFormat, timeFormat, weekStartDay} = dateSettings;
	const disabled = !available;
	const change = (patch: PreferencesPatch) => {
		setPreferences(patch).catch(() => {});
	};
	const today = {startYear: now.getFullYear(), startMonth: now.getMonth() + 1, startDay: now.getDate()};
	const dateOptions = withCurrent(dateFormatOptions(now), dateFormat, () =>
		formatPillLabel(today, {dateFormat, now}),
	);
	const timeOptions = withCurrent(timeFormatOptions(now), timeFormat, () => timeFormat);

	return (
		<section className="settings-section" id="settings-dates">
			<h3 className="settings-section-title">Dates</h3>
			{error !== null && (
				<div className="settings-row">
					<span className="settings-info">{error}</span>
				</div>
			)}
			<div className="settings-row">
				<label className="settings-label" htmlFor="settings-date-format">
					Date format
				</label>
				<select
					className="settings-select"
					disabled={disabled}
					id="settings-date-format"
					onChange={(event) => {
						change({dateFormat: event.target.value});
					}}
					value={dateFormat}
				>
					{dateOptions.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
			</div>
			<div className="settings-row">
				<label className="settings-label" htmlFor="settings-time-format">
					Time format
				</label>
				<select
					className="settings-select"
					disabled={disabled}
					id="settings-time-format"
					onChange={(event) => {
						change({timeFormat: event.target.value});
					}}
					value={timeFormat}
				>
					{timeOptions.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
			</div>
			<div className="settings-row">
				<label className="settings-label" htmlFor="settings-week-start">
					Start of week
				</label>
				<select
					className="settings-select"
					disabled={disabled}
					id="settings-week-start"
					onChange={(event) => {
						change(weekStartPatch(event.target.value === "1" ? 1 : 0));
					}}
					value={String(weekStartDay === 1 ? 1 : 0)}
				>
					<option value="0">Sunday</option>
					<option value="1">Monday</option>
				</select>
			</div>
			<div className="settings-row">
				<label className="settings-label" htmlFor="settings-custom-date-format">
					Custom date format
				</label>
				<div className="settings-custom-format">
					<CustomFormatInput
						ariaLabel="Custom date format"
						className="w-[200px]"
						disabled={disabled}
						id="settings-custom-date-format"
						key={dateFormat}
						onSave={(value) => {
							change({dateFormat: value});
						}}
						value={dateFormat}
					/>
					<CustomFormatInput
						ariaLabel="Custom time format"
						id="settings-custom-time-format"
						key={timeFormat}
						className="w-[120px]"
						disabled={disabled}
						onSave={(value) => {
							change({timeFormat: value});
						}}
						value={timeFormat}
					/>
					<a href={MOMENT_FORMAT_DOCS} rel="noreferrer" target="_blank">
						Learn more
					</a>
				</div>
			</div>
		</section>
	);
}

/**
 * Settings modal with theme selector and preferences.
 * Accessible from the user avatar button in the top bar.
 */
export function Settings() {
	const settingsOpen = useOutlineStore((state) => state.settingsOpen);
	const closeSettings = useOutlineStore((state) => state.closeSettings);
	const theme = useOutlineStore((state) => state.theme);
	const setTheme = useOutlineStore((state) => state.setTheme);
	const settingsSection = useOutlineStore((state) => state.settingsSection);
	const contentRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (settingsOpen && settingsSection === "Dates") {
			contentRef.current?.querySelector("#settings-dates")?.scrollIntoView({block: "start"});
		}
	}, [settingsOpen, settingsSection]);

	useHotkeys(
		"escape",
		() => {
			closeSettings();
		},
		{
			enabled: settingsOpen,
			enableOnFormTags: true,
		},
		[settingsOpen, closeSettings],
	);

	if (!settingsOpen) {
		return null;
	}

	const handleThemeChange = (newTheme: Theme) => {
		setTheme(newTheme);
	};

	return (
		<div
			className="settings-overlay"
			onClick={(event) => {
				if (event.target === event.currentTarget) {
					closeSettings();
				}
			}}
			role="presentation"
		>
			<div className="settings-modal">
				<div className="settings-header">
					<h2 className="settings-title">Settings</h2>
					<button className="settings-close" onClick={closeSettings} type="button">
						x
					</button>
				</div>

				<div className="settings-content" ref={contentRef}>
					<section className="settings-section">
						<h3 className="settings-section-title">Appearance</h3>

						<div className="settings-row">
							<span className="settings-label">Theme</span>
							<div className="settings-theme-buttons">
								<button
									className={`settings-theme-button ${theme === "light" ? "selected" : ""}`}
									onClick={() => {
										handleThemeChange("light");
									}}
									type="button"
								>
									<svg fill="currentColor" height="18" viewBox="0 0 512 512" width="18">
										<path d="M361.5 1.2c5 2.1 8.6 6.6 9.6 11.9L391 121l107.9 19.8c5.3 1 9.8 4.6 11.9 9.6s1.5 10.7-1.6 15.2L446.9 256l62.3 90.3c3.1 4.5 3.7 10.2 1.6 15.2s-6.6 8.6-11.9 9.6L391 391l-19.9 107.9c-1 5.3-4.6 9.8-9.6 11.9s-10.7 1.5-15.2-1.6L256 446.9l-90.3 62.3c-4.5 3.1-10.2 3.7-15.2 1.6s-8.6-6.6-9.6-11.9L121 391 13.1 371.1c-5.3-1-9.8-4.6-11.9-9.6s-1.5-10.7 1.6-15.2L65.1 256 2.8 165.7c-3.1-4.5-3.7-10.2-1.6-15.2s6.6-8.6 11.9-9.6L121 121 140.9 13.1c1-5.3 4.6-9.8 9.6-11.9s10.7-1.5 15.2 1.6L256 65.1 346.3 2.8c4.5-3.1 10.2-3.7 15.2-1.6zM160 256a96 96 0 1 1 192 0 96 96 0 1 1 -192 0zm224 0a128 128 0 1 0 -256 0 128 128 0 1 0 256 0z" />
									</svg>
									<span>Light</span>
								</button>
								<button
									className={`settings-theme-button ${theme === "dark" ? "selected" : ""}`}
									onClick={() => {
										handleThemeChange("dark");
									}}
									type="button"
								>
									<svg fill="currentColor" height="18" viewBox="0 0 384 512" width="18">
										<path d="M223.5 32C100 32 0 132.3 0 256S100 480 223.5 480c60.6 0 115.5-24.2 155.8-63.4c5-4.9 6.3-12.5 3.1-18.7s-10.1-9.7-17-8.5c-9.8 1.7-19.8 2.6-30.1 2.6c-96.9 0-175.5-78.8-175.5-176c0-65.8 36-123.1 89.3-153.3c6.1-3.5 9.2-10.5 7.7-17.3s-7.3-11.9-14.3-12.5c-6.3-.5-12.6-.8-19-.8z" />
									</svg>
									<span>Dark</span>
								</button>
								<button
									className={`settings-theme-button ${theme === "system" ? "selected" : ""}`}
									onClick={() => {
										handleThemeChange("system");
									}}
									type="button"
								>
									<svg fill="currentColor" height="18" viewBox="0 0 576 512" width="18">
										<path d="M64 0C28.7 0 0 28.7 0 64L0 352c0 35.3 28.7 64 64 64l176 0-10.7 32L160 448c-17.7 0-32 14.3-32 32s14.3 32 32 32l256 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-69.3 0L336 416l176 0c35.3 0 64-28.7 64-64l0-288c0-35.3-28.7-64-64-64L64 0zM512 64l0 224L64 288 64 64l448 0z" />
									</svg>
									<span>System</span>
								</button>
							</div>
						</div>
					</section>

					<DatesSection />

					<section className="settings-section">
						<h3 className="settings-section-title">Account</h3>
						<div className="settings-row">
							<span className="settings-info">
								Account settings are managed through your Workflowy account.
							</span>
						</div>
					</section>
				</div>
			</div>
		</div>
	);
}
