"""Chunk payload storage: local disk (dev, single server) or S3 (production, D12)."""

from __future__ import annotations

import asyncio
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from app.config import get_settings


class AudioStore(Protocol):
    async def put(self, key: str, data: bytes) -> None: ...
    async def get(self, key: str) -> bytes: ...
    async def delete_prefix(self, prefix: str) -> None: ...


def chunk_key(lecture_id: str, seq: int, codec: int) -> str:
    return f"audio/{lecture_id}/{seq:08d}.{'pcm' if codec == 0 else 'adpcm'}"


class DiskStore:
    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root.resolve()):
            raise ValueError("storage key escapes the audio directory")
        return path

    async def put(self, key: str, data: bytes) -> None:
        path = self._path(key)

        def write() -> None:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(path.suffix + ".tmp")
            tmp.write_bytes(data)
            tmp.replace(path)  # atomic: readers never see a partial chunk

        await asyncio.to_thread(write)

    async def get(self, key: str) -> bytes:
        return await asyncio.to_thread(self._path(key).read_bytes)

    async def delete_prefix(self, prefix: str) -> None:
        base = self._path(prefix)

        def remove() -> None:
            if base.is_dir():
                for child in sorted(base.rglob("*"), reverse=True):
                    child.unlink() if child.is_file() else child.rmdir()
                base.rmdir()

        await asyncio.to_thread(remove)


class S3Store:
    def __init__(self, bucket: str, region: str) -> None:
        import boto3

        self.bucket = bucket
        self.client = boto3.client("s3", region_name=region)

    async def put(self, key: str, data: bytes) -> None:
        await asyncio.to_thread(self.client.put_object, Bucket=self.bucket, Key=key, Body=data)

    async def get(self, key: str) -> bytes:
        response = await asyncio.to_thread(self.client.get_object, Bucket=self.bucket, Key=key)
        body: bytes = await asyncio.to_thread(response["Body"].read)
        return body

    async def delete_prefix(self, prefix: str) -> None:
        def remove() -> None:
            paginator = self.client.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
                keys = [{"Key": obj["Key"]} for obj in page.get("Contents", [])]
                if keys:
                    self.client.delete_objects(Bucket=self.bucket, Delete={"Objects": keys})

        await asyncio.to_thread(remove)


@lru_cache
def get_audio_store() -> AudioStore:
    settings = get_settings()
    if settings.s3_bucket:
        return S3Store(settings.s3_bucket, settings.aws_region)
    return DiskStore(settings.audio_dir)
