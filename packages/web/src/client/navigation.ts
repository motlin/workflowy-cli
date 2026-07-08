import {useNavigate} from 'react-router-dom';

export function uuidToShortId(uuid: string): string {
	return uuid.replaceAll('-', '').slice(-12);
}

export function useNodeNavigation() {
	const navigate = useNavigate();

	return {
		navigateToNode: (nodeId: string | null) => {
			if (nodeId === null) {
				void navigate('/');
			} else {
				void navigate(`/node/${uuidToShortId(nodeId)}`);
			}
		},
		navigateToRoot: () => void navigate('/'),
	};
}
