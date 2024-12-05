# EigenBlob

**Disclosure -- This is a third party library. This repository is not affiliated with Eigen Labs, Layr Labs, or any related entity. Use at your own risk. See LICENSE for more info.**

![Unit Tests](https://github.com/jbrower95/eigenblob/actions/workflows/test.yaml/badge.svg)

EigenBlob is a convenience library that wraps [EigenDA](https://github.com/Layr-Labs/eigenda) for usage
in web and server applications.

It's sort of like decentralized S3 -- post some data, and get it back later. All without a backend. See "Constraints" for more info on what you can do.


# Getting Started

## Installation

`npm install @jbrower95/eigenblob`.

## Sample Usage

```typescript
const client = new EigenDA(); // defaults to testnet

// you can `.put()` any JS object that is serializable.
const putRequest = client.put({hello: 'world'});

// putting takes a while... potentially a few minutes.
const blob = await putRequest.wait(10_000 /* max deadline in MS */);

// if something comes up, and you want to cancel an inflight request, try;
try {
    await putRequest.cancel();
} catch {};


// you can use the `putRequest` to fetch this item back later.
const blob = await client.get(putRequest);
expect(blob.hello).toEqual('world');

// if you want to be able to fetch the blob later, just serialize `putRequest`.
window.localStorage.setItem("my-blob", putRequest.toString()); // set

// then, later:
const contents = await client.get(
    EigenBlob.from(window.localStorage.getItem("my-blob"));
)
```

# More Information

## Under the hood

- `EigenBlob` uses `CompressionStream` to gzip encode your object after JSON encoding it.
- `EigenBlob` handles polling for different intermediate states and making sure that your blob is successfully added to the network
before returning.

## Constraints

- A `.put()` can take 3-8 minutes, as the SDK waits for the blob to finalize on the network.
- A `.get()` is typically much faster, on the order of seconds.
- Blobs can't be more than 2MB in size.
- Blobs exist for 14 days on the network.
- Testnet's free tier is limited to 1.28 kb/s. ([source](https://www.blog.eigenlayer.xyz/eigenda-updated-pricing/)).
- For mainnet, you can contact Eigen for access. ([source](https://docs.google.com/forms/d/e/1FAIpQLSdXvfxgRfIHWYu90FqN-2yyhgrYm9oExr0jSy7ERzbMUimJew/viewform)). Simply override the URL in your `EigenDA()` client.