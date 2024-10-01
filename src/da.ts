import { BlobStatus, BlobStatusRequest, DisperseBlobRequest, RetrieveBlobRequest } from "./gen/disperser/disperser_pb";
import { DisperserClient } from "./gen/disperser/DisperserServiceClientPb";
import { sleep, lessThan2MB, MB, toBase64, base64ToUint8Array, chunkData, dechunkData} from './utils';

type TEigenDaOptions = {
    uri: "mainnet" | "testnet" | `http://${string}` | `https://${string}`;
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
    static URI_TESTNET = "https://disperser-preprod-holesky-test.eigenda.xyz:443"

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

    put<T>(item: T, options?: TPutOptions): Promise<EigenBlob<T>> {  
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