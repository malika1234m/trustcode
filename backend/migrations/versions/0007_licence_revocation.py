"""licence revocation version, device stop times and integrity signals

Revision ID: 0007
Revises: 0006
"""
from alembic import op
import sqlalchemy as sa

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('licence_rev', sa.Integer(), server_default='0', nullable=False))
    op.add_column('licence_devices', sa.Column('stops_by', sa.DateTime(timezone=True), nullable=True))
    op.add_column('licence_devices', sa.Column('stop_reason', sa.String(length=30), nullable=True))
    op.add_column('licence_devices', sa.Column('ext_version', sa.String(length=20), nullable=True))
    op.add_column('licence_devices', sa.Column('build_hash', sa.String(length=64), nullable=True))
    op.add_column('licence_devices', sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    for c in ('last_seen_at', 'build_hash', 'ext_version', 'stop_reason', 'stops_by'):
        op.drop_column('licence_devices', c)
    op.drop_column('users', 'licence_rev')
