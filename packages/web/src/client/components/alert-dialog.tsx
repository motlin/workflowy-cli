import {dismissAlert, useAlertStore} from "../alert.js";
import {DialogCloseButton, DialogShell, DialogTitle} from "./dialog-shell.js";

/** Upstream's alert: a titled dialog with a message, closed by its X or Escape. */
export function AlertDialogView({title, message, onClose}: {title: string; message: string; onClose: () => void}) {
	return (
		<DialogShell onClose={onClose}>
			<DialogTitle>{title}</DialogTitle>
			<div className="text-base leading-base ">{message}</div>
			<DialogCloseButton onClose={onClose} />
		</DialogShell>
	);
}

/** Shows whatever `showAlert` last asked for. */
export function AlertDialog() {
	const alert = useAlertStore((state) => state.alert);
	return alert === null ? null : (
		<AlertDialogView title={alert.title} message={alert.message} onClose={dismissAlert} />
	);
}
