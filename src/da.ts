import { BlobStatus, BlobStatusRequest, DisperseBlobRequest, RetrieveBlobRequest } from "./gen/disperser/disperser_pb";
import { DisperserClient } from "./gen/disperser/DisperserServiceClientPb";
import { sleep, lessThan2MB, MB, toBase64, base64ToUint8Array, chunkData, dechunkData} from './utils';

type TEigenDaOptions = {
    uri: "testnet" | `http://${string}` | `https://${string}`;
};

type TPutOptions = {
    maxTimeoutMs: number
}

const BlobPollPeriodMs = 1000;

export class EigenBlob<T> {
    id: [bigint, Uint8Array | string]
    constructor(id: [bigint, Uint8Array | string]) {
        this.id = id;
    }
    toString() {
        return `${this.id[0].toString()}-${toBase64(this.id[1])}`
    }

    static from<A>(serialized: string): EigenBlob<A> {
        const parts = serialized.split('-');
        if (parts.length != 2) {
            throw new Error('invalid eigenblob.');
        }
        return new EigenBlob([
            BigInt(parts[0]),
            base64ToUint8Array(parts[1])
        ])
    }
}

export class LongRunningCancellablePromise<T> {
    cancelled: boolean = false;
    promise: Promise<T>;

    constructor(body: (resolve: (e: T) => void, reject: (err: any) => void, isCancelled: () => boolean) => void) {
         this.promise = new Promise((resolve, reject) => {
            const isCancelled = () => this.cancelled;
            body(resolve, reject, isCancelled)
        });
    }

    wait(deadlineMs: number = -1): Promise<T | undefined> {
        return new Promise((resolve, reject) => {
            const state = {timedOut: false, complete: false};
            let timeout: NodeJS.Timeout | undefined;
            if (deadlineMs > 0) {
                timeout = setTimeout(() => {
                    state.timedOut = true;
                    if (!state.complete) {
                        reject(new Error(`Operation timed out after ${deadlineMs}ms`));
                    }
                }, deadlineMs);
            }

            this.promise.then((res) =>{
                if (state.timedOut) {
                    if (timeout) {
                        clearTimeout(timeout);
                    }
                    return;
                }
                resolve(res);
            }).catch(err => {
                if (state.timedOut) {
                    if (timeout) {
                        clearTimeout(timeout);
                    }
                    return;
                }
                reject(err);
            }).finally(() => {
                state.complete = true;
            })
        });
    }

    async cancel(): Promise<void> {
        this.cancelled = true;
        await this.promise;
    }
}

/**
 * A simple wrapper around EigenDA which;
 *      - automatically applies gzip(JSON(object)) before uploading.
 *      - handles awaiting your submission for you and translating back into an id.
 *      - provides simple get/set methods for your app.
 * 
 * For mainnet usage, you still need to register manually.
 */
export class EigenDA {
    client: DisperserClient;

    static OPERATION_CANCELLED = "Operation cancelled.";
    static WAIT_TIMED_OUT = "Operation timed out.";

    static ACCOUNT = "eigenda-ts"
    static URI_TESTNET = "https://disperser-holesky-web.eigenda.xyz:443"

    constructor(options?: TEigenDaOptions) {
        switch (options?.uri) {
            case 'testnet':
                this.client = new DisperserClient(EigenDA.URI_TESTNET);
                break;
            default:
                if (!options?.uri) {
                    this.client = new DisperserClient(EigenDA.URI_TESTNET);
                } else {
                    this.client = new DisperserClient(options!.uri);
                }
        }
    }

    /**
     * Attempts to write a blob to EigenDA, which may take several minutes to finalize.
     * 
     *  - Await the result with `const res = client.put(...).wait(timeOut)`
     *    (with an optional timeout)
     *  - Cancel the long running result with `.cancel()`
     * 
     *  Use the returned type to `.get()`
     * 
     * @param item the JavaScript object to write to EigenDA.
     * @param options additional options for the `.put()` -- a timeout.
     * @returns 
     */
    put<T>(item: T, options?: TPutOptions): LongRunningCancellablePromise<EigenBlob<T>> {  
        return new LongRunningCancellablePromise((resolve, reject, isCancelled) => {
            const didTimeout = {
                did: false,
                completed: false,
            };
            if (options?.maxTimeoutMs) {
                setTimeout(() => {
                    if (!didTimeout.completed) {
                        didTimeout.did = true;
                        reject(new Error(EigenDA.WAIT_TIMED_OUT));
                    }
                })
            }
            if (isCancelled()) {
                return reject(new Error(EigenDA.OPERATION_CANCELLED));
            }
            (async () => {
                try {
                    let contents = JSON.stringify(item);
                    const encodedContents = new TextEncoder().encode(contents);
                    const blob = chunkData(encodedContents);
                    const base64Encoded = Buffer.from(blob).toString('base64')

                    if (!lessThan2MB(blob)) {
                        throw new Error(`blob too large -- maximum compressed size is 2mb (got ${blob.length / MB}mb)`)
                    }

                    const resp = await this.client.disperseBlob(
                        new DisperseBlobRequest()
                            .setData(base64Encoded)
                    )
                    const [requestId, result] = [resp.getRequestId(), resp.getResult()];

                    // spin while the blob's status isn't `BlobStatus::CONFIRMED, BlobStatus::FAILED, or BlobStatus::INSUFFICIENT_SIGNATURES`.
                    let latestRes = result;
                    let blobId: bigint | undefined; 
                    let batchHeaderHash: Uint8Array | string | undefined;

                    do  {
                        if (isCancelled()) {
                            return reject(EigenDA.OPERATION_CANCELLED);
                        }
                        await sleep(BlobPollPeriodMs);
                        let resp = await this.client.getBlobStatus(
                            new BlobStatusRequest().setRequestId(requestId)
                        );

                        let blobInfo = resp.getInfo();
                        let blobIndex = resp.getInfo()?.getBlobVerificationProof()?.getBlobIndex();
                        if (blobIndex) {
                            blobId = BigInt(blobIndex);
                        }

                        let batchHeaderHashBytes = blobInfo?.getBlobVerificationProof()?.getBatchMetadata()?.getBatchHeaderHash();
                        if (batchHeaderHashBytes) {
                            batchHeaderHash = batchHeaderHashBytes
                        }

                        latestRes = resp.getStatus();
                    } while ((![BlobStatus.CONFIRMED, BlobStatus.FAILED, BlobStatus.INSUFFICIENT_SIGNATURES].includes(latestRes) && blobId === undefined));

                    if (!blobId || !batchHeaderHash) {
                        throw new Error('Failed to obtain Blob ID or Batch Header Hash');
                    }

                    if (latestRes == BlobStatus.CONFIRMED) {
                        resolve(new EigenBlob<T>(
                            [blobId!, batchHeaderHash!],
                        ));
                    } else {
                        reject(new Error(`failed to confirm (code=${latestRes})`));
                    }
                } catch(e) {
                   console.error('Error in put operation:', e);
                   reject(e)
                } finally {
                    didTimeout.completed = true;
                }
            })();
        });
    }

    /**
     * Fetch a blob from EigenDA, given its blob ID. 
     * 
     * NOTE: 
     * ====================================================================
     * - Use EigenBlob.toString() to serialize the EigenBlob.
     * - Use EigenBlob.from(str) to restore the EigenBlob.
     * 
     * example:
     *  persist your blob id:
     *      const blobId = await client.put({}).wait();
     *      localStorage.setItem("my-blob", blobId.toString())
     *  retrieve it:
     *      const blobId = localStorage.getItem("my-blob");
     *      const blobContents = await client.get(EigenBlob.from(blobId));
     * ====================================================================
     * @param request 
     * @returns 
     */
    async get<T>(request: EigenBlob<T>): Promise<T> {
        try {
            const blob = await this.client.retrieveBlob(
                new RetrieveBlobRequest()
                    .setBlobIndex(Number(request.id[0]))
                    .setBatchHeaderHash(request.id[1])
            );
            const base64Data = blob.getData() as string;
            const chunkedContents = Buffer.from(base64Data, 'base64');
            const unchunkedContents = dechunkData(chunkedContents);
            const contentsAsText = new TextDecoder().decode(unchunkedContents);
            return JSON.parse(contentsAsText) as T;
        } catch (e) {
            if (e instanceof Error) {
                console.error('Error name:', e.name);
                console.error('Error message:', e.message);
                console.error('Error stack:', e.stack);
            }
            throw new Error(`Failed to retrieve and process blob: ${e instanceof Error ? e.message : 'Unknown error'}`, {cause: e});
        }
    }
}