"""tools.register_device: token shown once (hash stored), lecturer assignment, refusals."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.api.security import token_hash
from app.db.models import DeviceLecturer
from tests.conftest import run
from tests.helpers import seed_basics
from tools.register_device import RegistrationError, register_device


async def _register(factory, **kwargs):  # type: ignore[no-untyped-def]
    sessions = factory()
    try:
        async with sessions() as db:
            device, token = await register_device(db, **kwargs)
            links = list(
                (
                    await db.execute(select(DeviceLecturer).where(DeviceLecturer.device_id == device.id))
                ).scalars()
            )
            return device, token, links
    finally:
        await sessions.kw["bind"].dispose()


def test_register_device_stores_hash_and_assigns_lecturer(sessions_factory) -> None:  # type: ignore[no-untyped-def]
    seed = run(seed_basics(sessions_factory))
    device, token, links = run(
        _register(
            sessions_factory,
            serial=" aa11bb22cc33 ",
            name="Desk mic · Room 105",
            room="Room 105",
            lecturer_emails=["PRIYA@college.example"],
        )
    )
    assert device.serial == "AA11BB22CC33"
    assert device.token_hash == token_hash(token) and token not in device.token_hash
    assert [link.user_id for link in links] == [seed.lecturer_id]


@pytest.mark.parametrize(
    ("serial", "emails", "message"),
    [
        ("24A160C3F1B8", [], "already exists"),  # the seeded device's serial
        ("DD44EE55FF66", ["nobody@college.example"], "no lecturer"),
        ("DD44EE55FF66", ["arjun@college.example"], "no lecturer"),  # a student
    ],
)
def test_register_device_refusals(sessions_factory, serial: str, emails: list[str], message: str) -> None:  # type: ignore[no-untyped-def]
    run(seed_basics(sessions_factory))
    with pytest.raises(RegistrationError, match=message):
        run(_register(sessions_factory, serial=serial, name="x", room="y", lecturer_emails=emails))
