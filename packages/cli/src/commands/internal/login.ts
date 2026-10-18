import {Command} from "@oclif/core";
import {readWorkflowyCredentials, WorkflowyInternalClient} from "@workflowy/shared/api";
import {fileSessionStore, sessionFilePath} from "@workflowy/shared/node";

export default class Login extends Command {
	static override description =
		"Log in to Workflowy's internal API once and save the session cookie (mode 0600) so later live work needs no password";

	static override examples = ["op run -- <%= config.bin %> internal login"];

	public async run(): Promise<void> {
		await this.parse(Login);
		const credentials = readWorkflowyCredentials();
		if (!credentials) {
			this.error("WORKFLOWY_USERNAME and WORKFLOWY_PASSWORD must be set (run via op run)");
		}
		const file = sessionFilePath();
		await new WorkflowyInternalClient({credentials, sessionStore: fileSessionStore(file)}).login();
		this.log(`Saved Workflowy session cookie to ${file}`);
	}
}
