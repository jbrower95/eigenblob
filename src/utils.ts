export const sleep = (timeMs: number) => {
    return new Promise((resolve) => {
        setTimeout(resolve, timeMs)
    })
}


export const toStream = (arr: Uint8Array) => {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(arr);
            controller.close();
        }
    });
}

export const streamToString = async (stream: ReadableStream): Promise<string> => {
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

export const streamToBase64 = async (stream: ReadableStream): Promise<string> => {
    const reader = stream.getReader();
    let chunks: Uint8Array[] = [];

    let chunk;
    while (!(chunk = await reader.read()).done) {
        chunks.push(chunk.value);
    }

    // Concatenate all chunks into a single Uint8Array
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const fullUint8Array = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        fullUint8Array.set(chunk, offset);
        offset += chunk.length;
    }

    // Convert Uint8Array to a Base64-encoded string
    const binaryString = Array.from(fullUint8Array, byte => String.fromCharCode(byte)).join('');
    const base64Encoded = btoa(binaryString);

    return base64Encoded;
};

export function chunkData(data: Uint8Array): Uint8Array {
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

export function dechunkData(data: Uint8Array): Uint8Array {
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


export const streamToHex = async (stream: ReadableStream): Promise<string> => {
    const reader = stream.getReader();
    let chunks: Uint8Array[] = [];

    let chunk;
    while (!(chunk = await reader.read()).done) {
        chunks.push(chunk.value);
    }

    // Concatenate all chunks into a single Uint8Array
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const fullUint8Array = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        fullUint8Array.set(chunk, offset);
        offset += chunk.length;
    }

    // Convert Uint8Array to a hex-encoded string
    const hexEncoded = Array.from(fullUint8Array)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');

    return hexEncoded;
};


export const toUint8Array = async (stream: ReadableStream): Promise<Uint8Array> => {
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

export const MB = 1024 * 1024;

export function lessThan2MB(uint8Array: Uint8Array) {
    return uint8Array.length < (2 * MB);
}