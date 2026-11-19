"""Registers a classroom recorder and prints its device id and token ONCE.

  python -m tools.register_device --serial 24A160C3F1B8 --name "Desk mic · Room 204" \
      --room "Block A, Room 204" --lecturer priya@college.edu

Only the token's hash is stored. Put both values into firmware/recorder/nvs_config.csv (D10).
Re-running with the same serial is refused; deactivate or delete the old device first.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.security import new_token, token_hash
from app.db.models import Device, DeviceLecturer, Role, User
from app.db.session import get_engine, get_sessionmaker


class RegistrationError(Exception):
    pass


async def register_device(
    db: AsyncSession, *, serial: str, name: str, room: str, lecturer_emails: list[str]
) -> tuple[Device, str]:
    """Creates the device and its lecturer assignments; returns it with the plaintext token."""
    serial = serial.strip().upper()
    if (await db.execute(select(Device).where(Device.serial == serial))).scalars().first() is not None:
        raise RegistrationError(f"a device with serial {serial} already exists")
    lecturers: list[User] = []
    for email in lecturer_emails:
        user = (
            (await db.execute(select(User).where(func.lower(User.email) == email.strip().lower())))
            .scalars()
            .first()
        )
        if user is None or user.role not in (Role.lecturer, Role.admin):
            raise RegistrationError(f"no lecturer or admin with email {email}")
        lecturers.append(user)
    token = new_token(24)
    device = Device(name=name, room=room, serial=serial, token_hash=token_hash(token))
    db.add(device)
    await db.flush()
    for user in lecturers:
        db.add(DeviceLecturer(device_id=device.id, user_id=user.id))
    await db.commit()
    return device, token


async def main(args: argparse.Namespace) -> int:
    try:
        async with get_sessionmaker()() as db:
            device, token = await register_device(
                db, serial=args.serial, name=args.name, room=args.room, lecturer_emails=args.lecturer
            )
    except RegistrationError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    finally:
        await get_engine().dispose()
    print("Device registered. Put these into firmware/recorder/nvs_config.csv:")
    print(f"  device_id    = {device.id}")
    print(f"  device_token = {token}   (shown once; only its hash is stored)")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--serial", required=True, help="the board's MAC/serial, e.g. 24A160C3F1B8")
    parser.add_argument("--name", required=True)
    parser.add_argument("--room", required=True)
    parser.add_argument(
        "--lecturer", action="append", default=[], help="email of a lecturer who may use it (repeatable)"
    )
    raise SystemExit(asyncio.run(main(parser.parse_args())))
