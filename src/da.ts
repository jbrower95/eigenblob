import { BlobStatus, BlobStatusRequest, DisperseBlobRequest, RetrieveBlobRequest } from "./gen/disperser_pb";
import { DisperserClient } from "./gen/DisperserServiceClientPb";

type TEigenDaOptions = {
    URL: URL;
};

type TPutOptions = {
    maxTimeoutMs: number
}

let sleep = (timeMs: number) => {
    return new Promise((resolve) => {
        setTimeout(resolve, timeMs)
    })
}

const BlobPollPeriodMs = 1000;

type EigenBlob = {
    id: bigint;
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

    static ACCOUNT = "eigenda-ts"

    constructor(options: TEigenDaOptions) {
        this.client = new DisperserClient(options.URL.toString());
    }

    put<T>(item: T, options: TPutOptions): Promise<EigenBlob> {  
        return new Promise((resolve, reject) => {
            const didTimeout = {
                did: false,
                completed: false,
            };
            if (options.maxTimeoutMs) {
                setTimeout(() => {
                    if (!didTimeout.completed) {
                        didTimeout.did = true;
                        reject("operation timed out.");
                    }
                })
            }
            (async () => {
                try {
                    let contents = JSON.stringify(item);
                    const blob = 
                        new Uint8Array(await new Response(new Blob([ contents ], {type: 'application/json'})
                            .stream()
                            .pipeThrough(new CompressionStream('gzip'))).arrayBuffer());

                    const resp = await this.client.disperseBlob(
                        new DisperseBlobRequest()
                            .setAccountId(EigenDA.ACCOUNT)
                            .setData(blob)
                    )
                    const [requestId, result] = [resp.getRequestId(), resp.getResult()];

                    // spin while the blob's status isn't `BlobStatus::CONFIRMED, BlobStatus::FAILED, or BlobStatus::INSUFFICIENT_SIGNATURES`.
                    let latestRes = result;
                    let blobId: bigint | undefined; 
                    
                    do  {
                        await sleep(BlobPollPeriodMs);
                        let resp = await this.client.getBlobStatus(
                            new BlobStatusRequest().setRequestId(requestId)
                        );
                        let blobIndex = resp.getInfo()?.getBlobVerificationProof()?.getBlobIndex();
                        if (blobIndex) {
                            blobId = BigInt(blobIndex);
                        }

                        latestRes = resp.getStatus();
                    } while ((![BlobStatus.CONFIRMED, BlobStatus.FAILED, BlobStatus.INSUFFICIENT_SIGNATURES].includes(latestRes) && blobId === undefined));

                    resolve({
                        id: blobId!
                    });
                } catch(e) {
                   reject(e)
                } finally {
                    didTimeout.completed = true;
                }
            })();
        });
    }

    async get<T>(blobId: bigint): Promise<T> {
        const blob = await this.client.retrieveBlob(
            new RetrieveBlobRequest()
                .setBlobIndex(Number(blobId))
        );
        const contents = blob.getData() as Uint8Array;

        return JSON.parse(await new Response(new Blob([contents])
                .stream()
                .pipeThrough(new DecompressionStream('gzip')))
                .text()) as T;
    }
}

