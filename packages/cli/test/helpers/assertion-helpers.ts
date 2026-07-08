import {FAR_FUTURE_DATE} from '@workflowy/shared/temporal';

type TemporalRecord = {systemTo: string};

export function expectActiveRecord(node: TemporalRecord): void {
	expect(node.systemTo, 'Node should be active (systemTo = FAR_FUTURE_DATE)').toBe(FAR_FUTURE_DATE);
}

export function expectPhasedOut(node: TemporalRecord, expectedSystemTo?: string): void {
	expect(node.systemTo, 'Node should be phased out (systemTo != FAR_FUTURE_DATE)').not.toBe(FAR_FUTURE_DATE);

	if (expectedSystemTo !== undefined) {
		expect(node.systemTo, 'Node.systemTo should match expected').toBe(expectedSystemTo);
	}
}
