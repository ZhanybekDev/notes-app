import os

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test-secret-with-at-least-32-characters")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import scripts.worker as worker
from app import deps
from app.db import Base
from app.main import app
from app.rate_limit import reset_auth_rate_limits


@pytest.fixture(autouse=True)
def reset_worker_state():
    """Clear the worker's module-level counters between tests.

    The failure counters and the materialisation cursor outlive a test otherwise. Today neither
    can carry a value across — the cursor only fills at RECONCILE_LIMIT candidates — but a test
    that lowers the limit or seeds many notes would silently become order-dependent, and that is
    an unpleasant thing to debug.
    """
    worker._update_failures.clear()
    worker._materialize_after = None
    yield
    worker._update_failures.clear()
    worker._materialize_after = None


@pytest.fixture()
def db_session(tmp_path):
    """Plain session for testing domain modules without going through HTTP."""
    engine = create_engine(
        f"sqlite:///{tmp_path / 'unit.db'}",
        connect_args={"check_same_thread": False},
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSession()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client(tmp_path):
    reset_auth_rate_limits()
    db_url = f"sqlite:///{tmp_path / 'test.db'}"
    engine = create_engine(db_url, connect_args={"check_same_thread": False}, future=True)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[deps.get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
    reset_auth_rate_limits()
    Base.metadata.drop_all(bind=engine)
