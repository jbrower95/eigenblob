import fetch from 'cross-fetch';
import {EigenDA} from '../src/da';
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

it("should post a blob", async () => {
    const client = new EigenDA({mainnet: false});

    const resp = await client.put({hello: 'world'});
    const blob = await client.get<any>(resp.id);

    expect(blob.hello).toEqual('world');
}, 60 * SECONDS);