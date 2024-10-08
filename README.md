# EigenBlob

**🚧 Warning -- This is under active development. It literally doesn't work yet. 🚧**

**Disclosure -- This is a third party library. This repository is not affiliated with Eigen Labs, Layr Labs, or any related entity. Use at your own risk. See LICENSE for more info.**

![Unit Tests](https://github.com/jbrower95/eigenblob/actions/workflows/test.yaml/badge.svg)

EigenBlob is a convenience library that wraps [EigenDA](https://github.com/Layr-Labs/eigenda) for usage
in web and server applications.

## Installation

~~`npm install @jbrower95/eigenblob`~~ This is not yet available.

## Sample Usage

```typescript
const client = new EigenDA(); // defaults to testnet

// you can `.put()` any JS object that is serializable.
const resp = await client.put({hello: 'world'});

// you can use the `resp.id` to fetch this item back from anywhere.
const blob = await client.get(resp);
expect(blob.hello).toEqual('world');

// if you want to be able to fetch the blob later, just serialize `resp`.
window.localStorage.setItem("my-blob", resp.toString()); // set
const resp = EigenBlob.from(window.localStorage.getItem("my-blob"));
```

## Under the hood

- `EigenBlob` uses `CompressionStream` to gzip encode your object after JSON encoding it.
- `EigenBlob` handles polling for different intermediate states and making sure that your blob is successfully added to the network
before returning.

## Constraints

- A `.put()` can take 30-60s.
- A `.get()` is typically much faster, on the order of seconds.
- Blobs can't be more than 2MB in size.
- Blobs exist for 14 days on the network.
- Testnet's free tier is limited to 1.28 kb/s. ([source](https://www.blog.eigenlayer.xyz/eigenda-updated-pricing/)).
- For mainnet, you can contact Eigen for access. ([source](https://docs.google.com/forms/d/e/1FAIpQLSdXvfxgRfIHWYu90FqN-2yyhgrYm9oExr0jSy7ERzbMUimJew/viewform))