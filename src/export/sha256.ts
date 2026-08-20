// SHA-256 初始哈希值：前 8 个质数的平方根小数部分截取 32 位
const INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
];

// 轮常量：前 64 个质数的立方根小数部分截取 32 位，供每轮压缩函数混入
const ROUND = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const rotr = (value: number, amount: number) =>
  (value >>> amount) | (value << (32 - amount));

/** 增量 SHA-256：供流式媒体导出逐块累计哈希，无需整包缓冲。 */
export class Sha256 {
  private readonly state = INITIAL.slice();
  private readonly buffer = new Uint8Array(64);
  private readonly words = new Uint32Array(64);
  private buffered = 0;
  private byteLength = 0;
  private finished = false;

  update(input: Uint8Array): this {
    if (this.finished) throw new Error("SHA256_ALREADY_FINALIZED");
    this.byteLength += input.byteLength;
    let offset = 0;
    if (this.buffered) {
      const needed = 64 - this.buffered;
      const copied = Math.min(needed, input.byteLength);
      this.buffer.set(input.subarray(0, copied), this.buffered);
      this.buffered += copied;
      offset += copied;
      if (this.buffered === 64) {
        this.process(this.buffer);
        this.buffered = 0;
      }
    }
    // 剩余的整块 64 字节直接送入压缩，避免逐字节复制
    while (offset + 64 <= input.byteLength) {
      this.process(input.subarray(offset, offset + 64));
      offset += 64;
    }
    // 末尾不足 64 字节的部分暂存缓冲，等下次 update 或 finish 再处理
    if (offset < input.byteLength) {
      this.buffer.set(input.subarray(offset), 0);
      this.buffered = input.byteLength - offset;
    }
    return this;
  }

  digestHex(): string {
    if (!this.finished) this.finish();
    return this.state
      .map((word) => word.toString(16).padStart(8, "0"))
      .join("");
  }

  private finish(): void {
    // 填充规则：0x80 标志位 + 若干 0 + 8 字节原始比特数（大端），使总长对齐 64 字节块
    const originalBytes = this.byteLength;
    // 长度以字节为单位取模 64，推算出需补 0 的个数（为标志位与长度域留位）
    const zeroCount = (64 - ((originalBytes + 1 + 8) % 64)) % 64;
    const padding = new Uint8Array(1 + zeroCount + 8);
    padding[0] = 0x80;
    // 末 8 字节写入原始比特数（字节长度 × 8），按大端逐字节填充
    const bits = BigInt(originalBytes) * 8n;
    for (let index = 0; index < 8; index += 1)
      padding[padding.length - 1 - index] = Number(
        (bits >> BigInt(index * 8)) & 0xffn
      );
    this.update(padding);
    this.finished = true;
  }

  private process(block: Uint8Array): void {
    const words = this.words;
    // 将 64 字节消息块拆为 16 个 32 位大端字
    for (let index = 0; index < 16; index += 1)
      words[index] =
        ((block[index * 4] << 24) |
          (block[index * 4 + 1] << 16) |
          (block[index * 4 + 2] << 8) |
          block[index * 4 + 3]) >>>
        0;
    for (let index = 16; index < 64; index += 1) {
      const a = words[index - 15];
      const b = words[index - 2];
      words[index] =
        ((rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) +
          words[index - 16] +
          (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)) +
          words[index - 7]) >>>
        0;
    }
    let [a, b, c, d, e, f, g, h] = this.state;
    // 64 轮压缩：轮换 8 个状态字，混入扩展字与轮常量
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choose = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choose + ROUND[index] + words[index]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    // 压缩结果与原状态累加，作为下一消息块的初始状态
    this.state[0] = (this.state[0] + a) >>> 0;
    this.state[1] = (this.state[1] + b) >>> 0;
    this.state[2] = (this.state[2] + c) >>> 0;
    this.state[3] = (this.state[3] + d) >>> 0;
    this.state[4] = (this.state[4] + e) >>> 0;
    this.state[5] = (this.state[5] + f) >>> 0;
    this.state[6] = (this.state[6] + g) >>> 0;
    this.state[7] = (this.state[7] + h) >>> 0;
  }
}

/** 基于纯 JS 实现的同步 SHA-256。 */
export function sha256Sync(input: Uint8Array): string {
  return new Sha256().update(input).digestHex();
}

/** 一次性 SHA-256：优先使用原生 Web Crypto API，失败时回退到纯 JS 实现。 */
export async function sha256(input: Uint8Array): Promise<string> {
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      input as Uint8Array<ArrayBuffer>
    );
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (let i = 0; i < bytes.length; i++)
      hex += bytes[i].toString(16).padStart(2, "0");
    return hex;
  } catch {
    return sha256Sync(input);
  }
}
