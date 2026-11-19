"""Creates the first admin, and optionally demo data, in the configured database.

  python -m tools.seed --admin-email admin@college.edu --admin-name "Meena Iyer"
  python -m tools.seed --admin-email admin@college.edu --demo

Passwords are prompted (never passed on the command line). With --demo it also creates four
subjects, a lecturer, a student and one device, and prints the device token ONCE.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.security import hash_password, new_token, token_hash
from app.db.models import Device, DeviceLecturer, Role, Subject, User
from app.db.session import get_engine, get_sessionmaker

DEMO_SUBJECTS = [
    ("CS501", "Operating Systems"),
    ("CS502", "Computer Networks"),
    ("CS503", "Database Management Systems"),
    ("CS504", "Theory of Computation"),
]


def ask_password(label: str) -> str:
    while True:
        first = getpass.getpass(f"Password for {label}: ")
        if len(first) < 8:
            print("Use at least 8 characters.")
        elif first != getpass.getpass("Repeat: "):
            print("Passwords differ.")
        else:
            return first


async def ensure_user(db: AsyncSession, email: str, name: str, role: Role) -> User:
    existing = (
        (await db.execute(select(User).where(func.lower(User.email) == email.lower()))).scalars().first()
    )
    if existing is not None:
        print(f"exists: {email}")
        return existing
    user = User(email=email.lower(), name=name, role=role, password_hash=hash_password(ask_password(email)))
    db.add(user)
    await db.flush()
    print(f"created {role.value}: {email}")
    return user


async def main(args: argparse.Namespace) -> None:
    async with get_sessionmaker()() as db:
        await ensure_user(db, args.admin_email, args.admin_name, Role.admin)
        if args.demo:
            lecturer = await ensure_user(db, args.lecturer_email, "Demo Lecturer", Role.lecturer)
            await ensure_user(db, args.student_email, "Demo Student", Role.student)
            for code, name in DEMO_SUBJECTS:
                if not (await db.execute(select(Subject).where(Subject.code == code))).scalars().first():
                    db.add(Subject(code=code, name=name, lecturer_id=lecturer.id))
            serial = args.device_serial.upper()
            if not (await db.execute(select(Device).where(Device.serial == serial))).scalars().first():
                token = new_token(24)
                device = Device(
                    name="Desk mic · Room 204", room="Room 204", serial=serial, token_hash=token_hash(token)
                )
                db.add(device)
                await db.flush()
                db.add(DeviceLecturer(device_id=device.id, user_id=lecturer.id))
                print("\nDevice registered. Put these into firmware/recorder/nvs_config.csv:")
                print(f"  device_id    = {device.id}")
                print(f"  device_token = {token}   (shown once; only its hash is stored)\n")
        await db.commit()
    await get_engine().dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--admin-email", required=True)
    parser.add_argument("--admin-name", default="Administrator")
    parser.add_argument("--demo", action="store_true")
    parser.add_argument("--lecturer-email", default="lecturer@college.example")
    parser.add_argument("--student-email", default="student@college.example")
    parser.add_argument("--device-serial", default="24A160C3F1B8")
    asyncio.run(main(parser.parse_args()))
