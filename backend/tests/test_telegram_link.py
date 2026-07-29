from app.models import User
from app.telegram_link import LinkResult, issue_link_code, redeem_code, unlink


def make_user(db, username: str = "alice") -> User:
    user = User(username=username, password_hash="x", timezone="UTC")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_issue_link_code_replaces_previous(db_session):
    user = make_user(db_session)
    first, _ = issue_link_code(db_session, user)
    second, _ = issue_link_code(db_session, user)

    assert first != second
    assert (
        redeem_code(db_session, code=first, chat_id=100, telegram_username=None, language="en")[0]
        is LinkResult.UNKNOWN_OR_EXPIRED
    )
    assert (
        redeem_code(db_session, code=second, chat_id=100, telegram_username=None, language="en")[0]
        is LinkResult.LINKED
    )


def test_unlink_clears_binding_and_disables_notifications(db_session):
    user = make_user(db_session)
    code, _ = issue_link_code(db_session, user)
    redeem_code(db_session, code=code, chat_id=100, telegram_username="tg", language="ru")

    unlink(db_session, user)

    db_session.refresh(user)
    assert user.telegram_chat_id is None
    assert user.telegram_username is None
    assert user.telegram_language is None
    assert user.notifications_enabled is False
