import { TWorkerRequest, TWorkerResponse } from './protocol';

type TWorkerRequestPayload = TWorkerRequest extends infer TRequest
    ? TRequest extends TWorkerRequest
        ? Omit<TRequest, 'id'>
        : never
    : never;
export type TWorkerCompletionResponse = Exclude<TWorkerResponse, { type: 'progress' | 'error' }>;

interface IPendingRequest {
    readonly id: number;
    readonly resolve: (response: TWorkerCompletionResponse) => void;
    readonly reject: (error: Error) => void;
    readonly onProgress?: (response: Extract<TWorkerResponse, { type: 'progress' }>) => void;
}

export class WorkerClient {
    private worker: Worker;
    private nextRequestId: number = 1;
    private pendingRequest: IPendingRequest | null = null;
    private readonly workerFactory: () => Worker;


    public constructor(workerFactory: () => Worker = () => new Worker(
        new URL('./obfuscation.worker.ts', import.meta.url),
        { type: 'module' }
    )) {
        this.workerFactory = workerFactory;
        this.worker = this.createWorker();
    }

    public async request(
        payload: TWorkerRequestPayload,
        onProgress?: (response: Extract<TWorkerResponse, { type: 'progress' }>) => void
    ): Promise<TWorkerCompletionResponse> {
        if (this.pendingRequest !== null) {
            this.pendingRequest.reject(new Error('Superseded by a newer request.'));
            this.pendingRequest = null;
        }

        const id: number = this.nextRequestId++;

        return new Promise<TWorkerCompletionResponse>((resolve, reject): void => {
            this.pendingRequest = { id, resolve, reject, onProgress };
            this.worker.postMessage(<TWorkerRequest>{ ...payload, id });
        });
    }

    public cancel(): boolean {
        if (this.pendingRequest === null) {
            return false;
        }

        this.pendingRequest.reject(new Error('Obfuscation cancelled.'));
        this.pendingRequest = null;
        this.worker.terminate();
        this.worker = this.createWorker();

        return true;
    }

    public dispose(): void {
        this.pendingRequest?.reject(new Error('Worker client disposed.'));
        this.pendingRequest = null;
        this.worker.terminate();
    }

    private createWorker(): Worker {
        const worker: Worker = this.workerFactory();

        worker.addEventListener('message', (event: MessageEvent<TWorkerResponse>): void => {
            const response: TWorkerResponse = event.data;
            const pendingRequest: IPendingRequest | null = this.pendingRequest;

            if (pendingRequest === null || response.id !== pendingRequest.id) {
                return;
            }

            if (response.type === 'progress') {
                pendingRequest.onProgress?.(response);

                return;
            }

            this.pendingRequest = null;

            if (response.type === 'error') {
                pendingRequest.reject(new Error(response.message));

                return;
            }

            pendingRequest.resolve(response);
        });
        worker.addEventListener('error', (event: ErrorEvent): void => {
            const pendingRequest: IPendingRequest | null = this.pendingRequest;

            if (pendingRequest === null) {
                return;
            }

            this.pendingRequest = null;
            pendingRequest.reject(new Error(event.message || 'The obfuscation worker failed.'));
        });

        return worker;
    }
}
