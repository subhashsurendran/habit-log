const SBOX = Uint8Array.from([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
  0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
  0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
  0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
  0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
  0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
  0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
  0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
  0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
  0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
  0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
  0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
  0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
  0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]);

const RCON = Uint8Array.from([0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]);

function xtime(value: number): number {
  return ((value << 1) ^ ((value & 0x80) !== 0 ? 0x1b : 0)) & 0xff;
}

function expandKey(key: Uint8Array): Uint8Array {
  const words = 60;
  const out = new Uint8Array(words * 4);
  out.set(key);
  let generated = 8;
  const temp = new Uint8Array(4);
  while (generated < words) {
    temp.set(out.subarray((generated - 1) * 4, generated * 4));
    if (generated % 8 === 0) {
      const first = temp[0] ?? 0;
      temp[0] = (SBOX[temp[1] ?? 0] ?? 0) ^ (RCON[generated / 8] ?? 0);
      temp[1] = SBOX[temp[2] ?? 0] ?? 0;
      temp[2] = SBOX[temp[3] ?? 0] ?? 0;
      temp[3] = SBOX[first] ?? 0;
    } else if (generated % 8 === 4) {
      temp[0] = SBOX[temp[0] ?? 0] ?? 0;
      temp[1] = SBOX[temp[1] ?? 0] ?? 0;
      temp[2] = SBOX[temp[2] ?? 0] ?? 0;
      temp[3] = SBOX[temp[3] ?? 0] ?? 0;
    }
    for (let index = 0; index < 4; index += 1) {
      out[generated * 4 + index] = (out[(generated - 8) * 4 + index] ?? 0) ^ (temp[index] ?? 0);
    }
    generated += 1;
  }
  return out;
}

function encryptBlock(block: Uint8Array, roundKeys: Uint8Array): Uint8Array {
  const state = new Uint8Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) state[row * 4 + column] = block[column * 4 + row] ?? 0;
  }
  addRound(state, roundKeys, 0);
  for (let round = 1; round < 14; round += 1) {
    subBytes(state);
    shiftRows(state);
    mixColumns(state);
    addRound(state, roundKeys, round);
  }
  subBytes(state);
  shiftRows(state);
  addRound(state, roundKeys, 14);
  const out = new Uint8Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) out[column * 4 + row] = state[row * 4 + column] ?? 0;
  }
  return out;
}

function addRound(state: Uint8Array, roundKeys: Uint8Array, round: number): void {
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      const index = row * 4 + column;
      state[index] = (state[index] ?? 0) ^ (roundKeys[round * 16 + column * 4 + row] ?? 0);
    }
  }
}

function subBytes(state: Uint8Array): void {
  for (let index = 0; index < 16; index += 1) state[index] = SBOX[state[index] ?? 0] ?? 0;
}

function shiftRows(state: Uint8Array): void {
  const next = state.slice();
  for (let row = 1; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      state[row * 4 + column] = next[row * 4 + ((column + row) % 4)] ?? 0;
    }
  }
}

function mixColumns(state: Uint8Array): void {
  for (let column = 0; column < 4; column += 1) {
    const a0 = state[column] ?? 0;
    const a1 = state[4 + column] ?? 0;
    const a2 = state[8 + column] ?? 0;
    const a3 = state[12 + column] ?? 0;
    state[column] = xtime(a0) ^ xtime(a1) ^ a1 ^ a2 ^ a3;
    state[4 + column] = a0 ^ xtime(a1) ^ xtime(a2) ^ a2 ^ a3;
    state[8 + column] = a0 ^ a1 ^ xtime(a2) ^ xtime(a3) ^ a3;
    state[12 + column] = xtime(a0) ^ a0 ^ a1 ^ a2 ^ xtime(a3);
  }
}

function xorBlock(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) out[index] = (left[index] ?? 0) ^ (right[index] ?? 0);
  return out;
}

function shiftRight(block: Uint8Array): { block: Uint8Array; lsb: number } {
  const out = new Uint8Array(16);
  let carry = 0;
  for (let index = 0; index < 16; index += 1) {
    const value = block[index] ?? 0;
    out[index] = ((value >>> 1) | carry) & 0xff;
    carry = (value & 1) << 7;
  }
  return { block: out, lsb: (block[15] ?? 0) & 1 };
}

function gmul(xValue: Uint8Array, yValue: Uint8Array): Uint8Array {
  let z = new Uint8Array(16);
  let v = new Uint8Array(xValue);
  for (let bit = 0; bit < 128; bit += 1) {
    const byte = yValue[bit >>> 3] ?? 0;
    if ((byte & (0x80 >> (bit & 7))) !== 0) z = new Uint8Array(xorBlock(z, v));
    const shifted = shiftRight(v);
    v = new Uint8Array(shifted.block);
    if (shifted.lsb) v[0] = (v[0] ?? 0) ^ 0xe1;
  }
  return z;
}

function ghash(hashKey: Uint8Array, data: Uint8Array): Uint8Array {
  let y = new Uint8Array(16);
  const blocks = Math.ceil(data.length / 16);
  for (let index = 0; index < blocks; index += 1) {
    const block = new Uint8Array(16);
    block.set(data.subarray(index * 16, index * 16 + 16));
    y = new Uint8Array(gmul(xorBlock(y, block), hashKey));
  }
  const lengthBlock = new Uint8Array(16);
  const bits = data.length * 8;
  lengthBlock[12] = (bits >>> 24) & 0xff;
  lengthBlock[13] = (bits >>> 16) & 0xff;
  lengthBlock[14] = (bits >>> 8) & 0xff;
  lengthBlock[15] = bits & 0xff;
  return gmul(xorBlock(y, lengthBlock), hashKey);
}

function increment(counter: Uint8Array): void {
  for (let index = 15; index >= 12; index -= 1) {
    const next = ((counter[index] ?? 0) + 1) & 0xff;
    counter[index] = next;
    if (next !== 0) break;
  }
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return diff === 0;
}

export function encryptAesGcm(key: Uint8Array, iv: Uint8Array, plain: Uint8Array): { cipher: Uint8Array; tag: Uint8Array } {
  if (key.length !== 32 || iv.length !== 12) throw new Error("Could not store that on this device.");
  const roundKeys = expandKey(key);
  const hashKey = encryptBlock(new Uint8Array(16), roundKeys);
  const counter = new Uint8Array(16);
  counter.set(iv);
  counter[15] = 1;
  const stream = new Uint8Array(plain.length);
  const block = new Uint8Array(16);
  for (let offset = 0; offset < plain.length; offset += 16) {
    increment(counter);
    const keystream = encryptBlock(counter, roundKeys);
    const size = Math.min(16, plain.length - offset);
    for (let index = 0; index < size; index += 1) {
      stream[offset + index] = (plain[offset + index] ?? 0) ^ (keystream[index] ?? 0);
      block[index] = stream[offset + index] ?? 0;
    }
  }
  const tag = xorBlock(ghash(hashKey, stream), encryptBlock(counterFromIv(iv), roundKeys));
  return { cipher: stream, tag };
}

function counterFromIv(iv: Uint8Array): Uint8Array {
  const counter = new Uint8Array(16);
  counter.set(iv);
  counter[15] = 1;
  return counter;
}

export function decryptAesGcm(key: Uint8Array, iv: Uint8Array, cipher: Uint8Array, tag: Uint8Array): Uint8Array {
  if (key.length !== 32 || iv.length !== 12 || tag.length !== 16) throw new Error("Could not open the log on this device.");
  const roundKeys = expandKey(key);
  const hashKey = encryptBlock(new Uint8Array(16), roundKeys);
  const expected = xorBlock(ghash(hashKey, cipher), encryptBlock(counterFromIv(iv), roundKeys));
  if (!equalBytes(expected, tag)) throw new Error("Could not open the log on this device.");
  const plain = new Uint8Array(cipher.length);
  const counter = counterFromIv(iv);
  for (let offset = 0; offset < cipher.length; offset += 16) {
    increment(counter);
    const keystream = encryptBlock(counter, roundKeys);
    const size = Math.min(16, cipher.length - offset);
    for (let index = 0; index < size; index += 1) {
      plain[offset + index] = (cipher[offset + index] ?? 0) ^ (keystream[index] ?? 0);
    }
  }
  return plain;
}
