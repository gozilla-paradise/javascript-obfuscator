import type { TCLISanitizer } from '../../types/cli/TCLISanitizer';
import type { IBrowserEnvironment } from '../../interfaces/vm/IBrowserEnvironment';

export const BrowserEnvironmentSanitizer: TCLISanitizer<IBrowserEnvironment> = (
    value: string
): IBrowserEnvironment => {
    if (value !== 'http' && value !== 'https') {
        throw new ReferenceError(
            'Browser environment transport must be either `http` or `https`'
        );
    }

    return { transport: value };
};
