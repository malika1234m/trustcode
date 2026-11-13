"""offline licences: devices, issued licences, per-account policy, validation history

Revision ID: 0006
Revises: 0005
"""
from alembic import op
import sqlalchemy as sa

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('licence_devices',
        sa.Column('id', sa.String(length=32), nullable=False),
        sa.Column('user_id', sa.String(length=32), nullable=False),
        sa.Column('device_id', sa.String(length=64), nullable=False),
        sa.Column('public_key', sa.String(length=64), nullable=False),
        sa.Column('name', sa.String(length=80), nullable=False),
        sa.Column('platform', sa.String(length=40), nullable=True),
        sa.Column('status', sa.String(length=12), nullable=False),
        sa.Column('activated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_validated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_request_counter', sa.BigInteger(), server_default='0', nullable=False),
        sa.Column('deactivated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'device_id'))
    op.create_index('ix_licence_devices_user_id', 'licence_devices', ['user_id'])
    op.create_index('ix_licence_devices_status', 'licence_devices', ['status'])
    op.create_table('licences',
        sa.Column('id', sa.String(length=32), nullable=False),
        sa.Column('user_id', sa.String(length=32), nullable=False),
        sa.Column('device_row_id', sa.String(length=32), nullable=False),
        sa.Column('plan_id', sa.String(length=20), nullable=False),
        sa.Column('key_id', sa.String(length=20), nullable=False),
        sa.Column('issued_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('offline_until', sa.DateTime(timezone=True), nullable=False),
        sa.Column('paid_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_reason', sa.String(length=40), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['device_row_id'], ['licence_devices.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'))
    op.create_index('ix_licences_user_id', 'licences', ['user_id'])
    op.create_index('ix_licences_device_row_id', 'licences', ['device_row_id'])
    op.create_table('licence_policies',
        sa.Column('user_id', sa.String(length=32), nullable=False),
        sa.Column('offline_grace_days', sa.Integer(), nullable=True),
        sa.Column('max_devices', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.String(length=32), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'))
    op.create_table('licence_events',
        sa.Column('id', sa.String(length=32), nullable=False),
        sa.Column('user_id', sa.String(length=32), nullable=True),
        sa.Column('device_row_id', sa.String(length=32), nullable=True),
        sa.Column('licence_id', sa.String(length=32), nullable=True),
        sa.Column('event', sa.String(length=30), nullable=False),
        sa.Column('detail', sa.String(length=120), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'))
    op.create_index('ix_licence_events_user_id', 'licence_events', ['user_id'])
    op.create_index('ix_licence_events_device_row_id', 'licence_events', ['device_row_id'])
    op.create_index('ix_licence_events_event', 'licence_events', ['event'])
    op.create_index('ix_licence_events_created_at', 'licence_events', ['created_at'])


def downgrade():
    for ix in ('created_at', 'event', 'device_row_id', 'user_id'):
        op.drop_index(f'ix_licence_events_{ix}', table_name='licence_events')
    op.drop_table('licence_events')
    op.drop_table('licence_policies')
    op.drop_index('ix_licences_device_row_id', table_name='licences')
    op.drop_index('ix_licences_user_id', table_name='licences')
    op.drop_table('licences')
    op.drop_index('ix_licence_devices_status', table_name='licence_devices')
    op.drop_index('ix_licence_devices_user_id', table_name='licence_devices')
    op.drop_table('licence_devices')
