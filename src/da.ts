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
        const compressedContents = blob.getData() as Uint8Array;
        try {
            const contentsAsText =  await streamToString(toStream(compressedContents).pipeThrough(new DecompressionStream('gzip')))
            return JSON.parse(contentsAsText) as T;
        } catch (e) {
            throw new Error(`invalid blob -- this blob was likely not uploaded with eigenblob.`, {cause: e});
        }
    }
}

