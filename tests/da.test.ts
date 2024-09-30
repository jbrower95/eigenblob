import fetch from 'cross-fetch';
import {EigenDA} from '../src/da';
import {expect} from '@jest/globals';

// @ts-ignore
process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

const {
    ReadableStream, CompressionStream, DecompressionStream
  } = require('node:stream/web');
const XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;

const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
global.ReadableStream = ReadableStream;
global.CompressionStream = CompressionStream;
global.DecompressionStream = DecompressionStream;
global.XMLHttpRequest = XMLHttpRequest;

const SECONDS = 1000;

it("should be able to post a blob", async () => {
    const client = new EigenDA({uri: "https://localhost:5001"}); // defaults to testnet

    const resp = await client.put({hello: 'world'});
    const blob = await client.get<any>(resp.id);

    expect(blob.hello).toEqual('world');
}, 15 * SECONDS); 

// it("should work against hosted example", async () => {
//   const client = new EigenDA({uri: "https://disperser-preprod-holesky-test.eigenda.xyz:443"}); // defaults to testnet

//   const resp = await client.put({hello: 'world'});
//   const blob = await client.get<any>(resp.id);

//   expect(blob.hello).toEqual('world');
// }, 15 * SECONDS); 

