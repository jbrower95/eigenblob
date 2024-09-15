import { BlobStatus, BlobStatusRequest, DisperseBlobRequest, RetrieveBlobRequest } from "./gen/disperser/disperser_pb";
import { DisperserClient } from "./gen/disperser/DisperserServiceClientPb";

type TEigenDaOptions = {
    mainnet: boolean
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

const toStream = (arr: Uint8Array) => {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(arr);
            controller.close();
        }
    });
}

const streamToString = async (stream: ReadableStream): Promise<string> => {
    const reader = stream.getReader();
    let result = '';
    const decoder = new TextDecoder();

    let chunk;
    while (!(chunk = await reader.read()).done) {
        result += decoder.decode(chunk.value, { stream: true });
    }

    // Ensure the final part of the text is decoded
    result += decoder.decode();
    return result;
};


const toUint8Array = async (stream: ReadableStream): Promise<Uint8Array> => {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;

    // Accumulate all chunks from the stream
    let result: ReadableStreamReadResult<any>;
    while (!(result = await reader.read()).done) {
        chunks.push(result.value);
        length += result.value.length;
    }

    // Combine all chunks into a single Uint8Array
    const combined = new Uint8Array(length);
    let position = 0;
    for (const chunk of chunks) {
        combined.set(chunk, position);
        position += chunk.length;
    }

    return combined;
};

const MB = 1024 * 1024;

function lessThan2MB(uint8Array: Uint8Array) {
    return uint8Array.length < (2 * MB);
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
    static URI_TESTNET = "disperser-holesky.eigenda.xyz:443"

    constructor(options: TEigenDaOptions) {
        if (options.mainnet) {
            throw new Error("permissionless access to mainnet is not yet available.");
        }
        this.client = new DisperserClient(EigenDA.URI_TESTNET);
    }

    put<T>(item: T, options?: TPutOptions): Promise<EigenBlob> {  
        return new Promise((resolve, reject) => {
            const didTimeout = {
                did: false,
                completed: false,
            };
            if (options?.maxTimeoutMs) {
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
                    const blob = await toUint8Array(
                        toStream(new TextEncoder().encode(contents))
                            .pipeThrough(new CompressionStream('gzip'))
                    );
                    if (!lessThan2MB(blob)) {
                        throw new Error(`blob too large -- maximum compressed size is 2mb (got ${blob.length / MB}mb)`)
                    }

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

        return JSON.parse(
            await streamToString(
                toStream(contents)
                    .pipeThrough(new DecompressionStream('gzip'))
            )
        ) as T;
    }
}

