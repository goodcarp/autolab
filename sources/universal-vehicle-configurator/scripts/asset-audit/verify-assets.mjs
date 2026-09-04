import { createHash } from "node:crypto";
import console from "node:console";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "../..");

const expected = [
  {
    path: "public/images/showroom-fallback.webp",
    width: 1600,
    height: 900,
    maxBytes: 180_000,
    sha256: "293c5e9de95cfd0e64646e326aeda72ed3b6fa0cf52feb06aea94d49ec5ba682",
  },
  {
    path: "public/images/vehicle-side.webp",
    width: 1600,
    height: 900,
    maxBytes: 220_000,
    sha256: "ee803588f352b176e5d40427914169e7469e3f0f1f5808399ec37811124e0cca",
  },
  {
    path: "public/images/vehicle-side-blueprint.webp",
    width: 1600,
    height: 900,
    maxBytes: 420_000,
    sha256: "0bd369c9e330716c409bf91ba3ce75eb7da11719c6327ddfc0bd4def375e4785",
  },
  {
    path: "public/images/vehicle-scan-mask.webp",
    width: 1600,
    height: 900,
    maxBytes: 30_000,
    sha256: "4f9cabec2f1f1ad9c5ab6d473b4f8b96114484b88aa112398023f9cea44aa1d0",
  },
  {
    path: "public/images/vehicle-paint-mask.webp",
    width: 1600,
    height: 900,
    maxBytes: 50_000,
    sha256: "f1c57ed4f573af14f17ef7b60641a2afcf99af52c995f5644809a86b0b599057",
  },
  {
    path: "public/images/representative-wheel-inset.webp",
    width: 512,
    height: 512,
    maxBytes: 120_000,
    sha256: "ff3a517c19711c48cb90b9d195eb1144e36c145123812b9e342a37460d418a90",
  },
];

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function webpDimensions(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error("not a WebP RIFF file");
  }

  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    return {
      width: readUInt24LE(buffer, 24) + 1,
      height: readUInt24LE(buffer, 27) + 1,
    };
  }

  if (chunk === "VP8 ") {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  if (chunk === "VP8L") {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    };
  }

  throw new Error(`unsupported WebP chunk ${chunk}`);
}

let failed = false;
let totalBytes = 0;

for (const asset of expected) {
  const absolutePath = resolve(root, asset.path);
  try {
    const [buffer, metadata] = await Promise.all([
      readFile(absolutePath),
      stat(absolutePath),
    ]);
    const digest = createHash("sha256").update(buffer).digest("hex");
    const dimensions = webpDimensions(buffer);
    const checks = [
      [digest === asset.sha256, `hash ${digest}`],
      [metadata.size <= asset.maxBytes, `${metadata.size} bytes`],
      [
        dimensions.width === asset.width && dimensions.height === asset.height,
        `${dimensions.width}x${dimensions.height}`,
      ],
    ];
    const errors = checks.filter(([ok]) => !ok).map(([, message]) => message);
    if (errors.length > 0) {
      failed = true;
      console.error(`FAIL ${asset.path}: ${errors.join(", ")}`);
      continue;
    }
    totalBytes += metadata.size;
    console.log(`PASS ${asset.path} · ${dimensions.width}x${dimensions.height} · ${metadata.size} bytes`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${asset.path}: ${error.message}`);
  }
}

console.log(`Approved public safety-pack payload: ${totalBytes} bytes`);
console.log("Live 3D asset: licensed primary with same-model safety frames.");

if (failed) {
  process.exitCode = 1;
}
