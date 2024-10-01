import { BlobStatus, BlobStatusRequest, DisperseBlobRequest, RetrieveBlobRequest } from "./gen/disperser/disperser_pb";
import { DisperserClient } from "./gen/disperser/DisperserServiceClientPb";
import { sleep, toStream, streamToString, toUint8Array, lessThan2MB, MB} from './utils';

type TEigenDaOptions = {
    uri: "mainnet" | "testnet" | `http://${string}` | `https://${string}`;
};

type TPutOptions = {
    maxTimeoutMs: number
}

const BlobPollPeriodMs = 1000;

type EigenBlob = {
    id: bigint;
    batchHeaderHash: Uint8Array | string;
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

    constructor(options?: TEigenDaOptions) {
        switch (options?.uri) {
            case 'mainnet':
                throw new Error("permissionless access to mainnet is not yet available.");
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
                    console.log('Starting put operation with item:', item);
                    let contents = JSON.stringify(item);
                    console.log('JSON stringified contents:', contents);

                    const encodedContents = new TextEncoder().encode(contents);
                    console.log('Encoded data length:', encodedContents.length);

                    const blob = chunkData(encodedContents);
                    console.log('Chunked blob length:', blob.length);

                    const base64Encoded = Buffer.from(blob).toString('base64');

                    if (!lessThan2MB(blob)) {
                        throw new Error(`blob too large -- maximum compressed size is 2mb (got ${blob.length / MB}mb)`)
                    }

                    console.log('Dispersing blob...');
                    const resp = await this.client.disperseBlob(
                        new DisperseBlobRequest()
                            .setData(base64Encoded)
                    )
                    const [requestId, result] = [resp.getRequestId(), resp.getResult()];
                    console.log('Disperse blob response:', { requestId, result });

                    // spin while the blob's status isn't `BlobStatus::CONFIRMED, BlobStatus::FAILED, or BlobStatus::INSUFFICIENT_SIGNATURES`.
                    let latestRes = result;
                    let blobId: bigint | undefined; 
                    let batchHeaderHash: Uint8Array | string | undefined;

                    console.log('Polling for blob status...');
                    do  {
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
                        console.log('Current blob status:', latestRes, 'Blob ID:', blobId, 'Batch Header Hash:', batchHeaderHash);
                    } while ((![BlobStatus.CONFIRMED, BlobStatus.FAILED, BlobStatus.INSUFFICIENT_SIGNATURES].includes(latestRes) && blobId === undefined));

                    if (!blobId || !batchHeaderHash) {
                        throw new Error('Failed to obtain Blob ID or Batch Header Hash');
                    }

                    console.log('Put operation completed. Blob ID:', blobId, 'Batch Header Hash:', batchHeaderHash);
                    resolve({
                        id: blobId!,
                        batchHeaderHash: batchHeaderHash!
                    });
                } catch(e) {
                   console.error('Error in put operation:', e);
                   reject(e)
                } finally {
                    didTimeout.completed = true;
                }
            })();
        });
    }

    async get<T>(blobId: bigint, batchHeaderHash: Uint8Array | string): Promise<T> {
        try {
            console.log('Starting get operation for blob ID:', blobId);
            const blob = await this.client.retrieveBlob(
                new RetrieveBlobRequest()
                    .setBlobIndex(Number(blobId))
                    .setBatchHeaderHash(batchHeaderHash)
            );
            const base64Data = blob.getData() as string;
            console.log('Retrieved base64 data length:', base64Data.length);

            const chunkedContents = Buffer.from(base64Data, 'base64');
            console.log('Decoded chunked data length:', chunkedContents.length);

            const unchunkedContents = dechunkData(chunkedContents);
            console.log('Unchunked data length:', unchunkedContents.length);

            const contentsAsText = new TextDecoder().decode(unchunkedContents);
            console.log('Decoded text:', contentsAsText);

            return JSON.parse(contentsAsText) as T;
        } catch (e) {
            console.error('Detailed error in get operation:', e);
            if (e instanceof Error) {
                console.error('Error name:', e.name);
                console.error('Error message:', e.message);
                console.error('Error stack:', e.stack);
            }
            throw new Error(`Failed to retrieve and process blob: ${e instanceof Error ? e.message : 'Unknown error'}`, {cause: e});
        }
    }
}

function chunkData(data: Uint8Array): Uint8Array {
    const result = new Uint8Array(Math.ceil(data.length / 31) * 32);
    let j = 0;
    for (let i = 0; i < result.length; i++) {
        if (i % 32 === 0) {
            result[i] = 0; // Add empty byte at the start of each 32-byte chunk
        } else {
            result[i] = j < data.length ? data[j++] : 0;
        }
    }
    return result;
}

function dechunkData(data: Uint8Array): Uint8Array {
    const result = new Uint8Array(Math.floor(data.length / 32) * 31);
    let j = 0;
    for (let i = 0; i < data.length; i++) {
        if (i % 32 !== 0) {
            result[j++] = data[i];
        }
    }
    // Find the last non-zero byte
    let lastNonZeroIndex = result.length - 1;
    while (lastNonZeroIndex >= 0 && result[lastNonZeroIndex] === 0) {
        lastNonZeroIndex--;
    }
    // Return a new Uint8Array without trailing zeros
    return result.slice(0, lastNonZeroIndex + 1);
}
