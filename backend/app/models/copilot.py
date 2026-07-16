from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TimestampMixin


class CopilotConversation(Base, TimestampMixin):
    """Sessão de chat do Copilot com o LLM, sobre um ou mais devices."""

    __tablename__ = "copilot_conversation"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=True, index=True
    )
    user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(200), default="Nova conversa")
    mode: Mapped[str] = mapped_column(String(16), default="manual")  # chat | manual | auto
    device_ids: Mapped[list] = mapped_column(JSON, default=list)
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    tokens_total: Mapped[int] = mapped_column(Integer, default=0)  # acumulado na conversa
    tokens_context: Mapped[int] = mapped_column(Integer, default=0)  # prompt_tokens do último turno


class CopilotMessage(Base):
    """Mensagem da conversa (user | assistant | tool)."""

    __tablename__ = "copilot_message"

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("copilot_conversation.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))  # user | assistant | tool
    content: Mapped[str] = mapped_column(Text, default="")
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)  # raciocínio (thinking) do assistant
    tool_calls: Mapped[list | None] = mapped_column(JSON, nullable=True)  # p/ assistant
    tool_call_id: Mapped[str | None] = mapped_column(String(80), nullable=True)  # p/ tool
    name: Mapped[str | None] = mapped_column(String(80), nullable=True)  # nome da tool
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CopilotAction(Base):
    """Comando proposto pelo LLM aguardando/registrando aprovação e execução."""

    __tablename__ = "copilot_action"

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("copilot_conversation.id", ondelete="CASCADE"), index=True
    )
    device_id: Mapped[int | None] = mapped_column(ForeignKey("device.id", ondelete="SET NULL"), nullable=True)
    tool_call_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    command: Mapped[str] = mapped_column(Text, default="")
    rationale: Mapped[str] = mapped_column(Text, default="")
    classification: Mapped[str] = mapped_column(String(8), default="write")  # read | write
    high_risk: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending|executed|failed|rejected
    output: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CopilotTool(Base, TimestampMixin):
    """Ferramenta externa registrada por ORG (MCP HTTP Stream, OpenAPI, Skill)."""

    __tablename__ = "copilot_tool"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=True, index=True
    )
    kind: Mapped[str] = mapped_column(String(16))  # mcp | openapi | skill
    name: Mapped[str] = mapped_column(String(120))
    config: Mapped[dict] = mapped_column(JSON, default=dict)  # {url, auth_header, auth_value, ...}
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
