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