"""usernames

Adds users.username (unique, lowercase). Existing accounts get one derived from their name, so they can sign in
with it straight away; it can be changed in Settings.

Revision ID: 0005
Revises: 0004
"""
import re

from alembic import op
import sqlalchemy as sa


revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def _derive(name: str | None, email: str, user_id: int) -> str:
    base = re.sub(r"[^a-z0-9._-]", "", (name or "").lower()) or re.sub(r"[^a-z0-9._-]", "", email.split("@")[0].lower())
    base = base.lstrip("._-") or f"user{user_id}"
    if len(base) < 3:
        base += "user"
    return base[:26]


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('username', sa.String(length=30), nullable=True))

    conn = op.get_bind()
    used: set[str] = set()
    for user_id, name, email in conn.execute(sa.text("SELECT id, name, email FROM users ORDER BY id")).fetchall():
        base = _derive(name, email, user_id)
        candidate, n = base, 1
        while candidate in used:
            n += 1
            candidate = f"{base}{n}"
        used.add(candidate)
        conn.execute(sa.text("UPDATE users SET username = :u WHERE id = :i"), {"u": candidate, "i": user_id})

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_users_username'), ['username'], unique=True)


def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_users_username'))
        batch_op.drop_column('username')
