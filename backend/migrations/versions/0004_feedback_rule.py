"""feedback: remember which rule a rating was about

Revision ID: 0004
Revises: 0003
"""
from alembic import op
import sqlalchemy as sa

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('feedback') as batch:
        batch.add_column(sa.Column('rule', sa.String(length=120), nullable=True))


def downgrade():
    with op.batch_alter_table('feedback') as batch:
        batch.drop_column('rule')
