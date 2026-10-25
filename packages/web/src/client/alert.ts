import {create} from "zustand";

/** Upstream `WF.GuiDialogs.showAlert(message, title)`: one message dialog at a time. */
export interface AlertState {
	alert: {title: string; message: string} | null;
}

export const useAlertStore = create<AlertState>(() => ({alert: null}));

export function showAlert(message: string, title: string): void {
	useAlertStore.setState({alert: {title, message}});
}

export function dismissAlert(): void {
	useAlertStore.setState({alert: null});
}
