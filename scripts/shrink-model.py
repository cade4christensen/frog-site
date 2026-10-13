#!/usr/bin/env python3
"""Shrinks a frog .glb for the web by downsizing its textures.

The frog is only a couple hundred dithered pixels on screen, so 4096px
textures (and a lossless PNG color map) are mostly wasted download. This
resizes every embedded texture to at most SIZE px and stores color/occlusion
maps as JPEG. Geometry, skeleton, morphs and animations are left untouched.

    python3 scripts/shrink-model.py <in.glb> [out.glb]   (default out: public/models/frog.glb)

Uses macOS `sips` for image work, so no extra packages are needed.
"""
import json
import os
import struct
import subprocess
import sys
import tempfile

SIZE = 1024
QUALITY = 85


def shrink(data: bytes, mime: str, tmp: str) -> tuple[bytes, str]:
    src = os.path.join(tmp, "in." + ("png" if "png" in mime else "jpg"))
    dst = os.path.join(tmp, "out.jpg")
    with open(src, "wb") as f:
        f.write(data)
    subprocess.run(
        ["sips", "-Z", str(SIZE), "-s", "format", "jpeg", "-s", "formatOptions", str(QUALITY), src, "--out", dst],
        check=True,
        capture_output=True,
    )
    with open(dst, "rb") as f:
        out = f.read()
    # Only keep the new version if it's actually smaller.
    return (out, "image/jpeg") if len(out) < len(data) else (data, mime)


def main():
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else "public/models/frog.glb"
    b = open(src, "rb").read()
    json_len = struct.unpack("<I", b[12:16])[0]
    gltf = json.loads(b[20 : 20 + json_len])
    bin_start = 20 + json_len + 8
    views = gltf["bufferViews"]

    def view_bytes(v):
        o = bin_start + v.get("byteOffset", 0)
        return b[o : o + v["byteLength"]]

    chunks = [view_bytes(v) for v in views]
    with tempfile.TemporaryDirectory() as tmp:
        for img in gltf.get("images", []):
            i = img["bufferView"]
            before = len(chunks[i])
            chunks[i], img["mimeType"] = shrink(chunks[i], img["mimeType"], tmp)
            print(f"  {img.get('name', 'image')}: {before // 1024} KB -> {len(chunks[i]) // 1024} KB")

    # Lay the buffer views back out, 4-byte aligned, in their original order.
    blob = bytearray()
    for v, data in zip(views, chunks):
        blob += b"\0" * (-len(blob) % 4)
        v["byteOffset"] = len(blob)
        v["byteLength"] = len(data)
        blob += data
    blob += b"\0" * (-len(blob) % 4)
    gltf["buffers"][0]["byteLength"] = len(blob)

    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(dst, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(blob), 0x004E4942) + bytes(blob))
    print(f"{os.path.getsize(src) // 1024} KB -> {total // 1024} KB  ({dst})")


if __name__ == "__main__":
    main()
