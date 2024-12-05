import {EigenDA, EigenBlob} from '../src/da';
import {expect} from '@jest/globals';

const {
    ReadableStream, CompressionStream, DecompressionStream
  } = require('node:stream/web');
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
global.ReadableStream = ReadableStream;
global.CompressionStream = CompressionStream;
global.DecompressionStream = DecompressionStream;

const SECONDS = 1000;

const TEST_URI = "https://disperser-holesky-web.eigenda.xyz:443";

it("should be able to post a JSON blob", async () => {
    const client = new EigenDA({uri: TEST_URI});

    const resp = await client.put({hello: 'world'}).wait(500 * SECONDS);
    expect(resp).not.toBeUndefined();
    if (!resp) {
      throw new Error()
    }

    const blob = await client.get(resp);
    expect(blob.hello).toEqual('world');
}, 600 * SECONDS);

it("can time out while waiting for a long-running blob task.", async () => {
  const client = new EigenDA({uri: TEST_URI});
  const resp = client.put({hello: 'world'});
  await expect(resp.wait(100)).rejects.toThrow(EigenDA.WAIT_TIMED_OUT);
}, 600 * SECONDS);

it("can cancel while waiting for a long-running blob task.", async () => {
  const client = new EigenDA({uri: TEST_URI});
  const resp = client.put({hello: 'world'});
  expect(resp.cancel()).rejects.toThrow(EigenDA.OPERATION_CANCELLED);
}, 600 * SECONDS);

it("should be able to post a binary blob", async () => {
  const client = new EigenDA({uri: TEST_URI});
  const resp = await client.put({pngBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/wcAAgUBdssEZAAAAABJRU5ErkJggg=='}).wait();
  if (!resp) {
    throw new Error(`Failed to post in time.`);
  }
  
  const blob = await client.get(resp);
  expect(blob.pngBase64).not.toBeNull();
}, 600 * SECONDS);

it("should be able to save an EigenBlob to string", async () => {
  const blob = new EigenBlob([5n, new Uint8Array(new TextEncoder().encode("123"))]);
  const val = blob.toString();
  const blob2 = EigenBlob.from(val);
  expect(blob.id).toEqual(blob2.id);
}, 600 * SECONDS);