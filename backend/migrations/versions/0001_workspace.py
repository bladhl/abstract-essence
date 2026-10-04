"""Initial local workspace schema.

Revision ID: 0001
"""

import sqlalchemy as sa
from alembic import op
from sqlmodel import UTCDateTime

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "document",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("total_pages", sa.Integer(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
    )
    op.create_table(
        "page",
        sa.Column(
            "document_id",
            sa.Uuid(),
            sa.ForeignKey("document.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("number", sa.Integer(), primary_key=True),
        sa.Column("text", sa.String(), nullable=False),
    )
    op.create_table(
        "analysis",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "document_id",
            sa.Uuid(),
            sa.ForeignKey("document.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("model", sa.String(), nullable=False),
        sa.Column("page_start", sa.Integer(), nullable=False),
        sa.Column("page_end", sa.Integer(), nullable=False),
        sa.Column("attempt", sa.String(), nullable=False),
        sa.Column("output", sa.JSON(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
    )
    op.create_table(
        "note",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "document_id",
            sa.Uuid(),
            sa.ForeignKey("document.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("page", sa.Integer(), nullable=False),
        sa.Column("quote", sa.String(), nullable=False),
        sa.Column("text", sa.String(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
    )
    op.create_table(
        "feedback",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "analysis_id",
            sa.Uuid(),
            sa.ForeignKey("analysis.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("question", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("model", sa.String(), nullable=False),
        sa.Column("output", sa.JSON(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
    )
    op.create_table(
        "connection",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "source_id",
            sa.Uuid(),
            sa.ForeignKey("document.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "target_id",
            sa.Uuid(),
            sa.ForeignKey("document.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("relationship", sa.String(), nullable=False),
        sa.Column("evidence", sa.String(), nullable=False),
    )


def downgrade():
    for table in ("connection", "feedback", "note", "analysis", "page", "document"):
        op.drop_table(table)
