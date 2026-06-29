from __future__ import annotations

import smtplib
import ssl
import json
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path
from typing import Any

from server import config


class MailConfigError(ValueError):
    """Raised when SMTP config exists but cannot be used."""


@dataclass(frozen=True)
class SmtpConfig:
    host: str
    port: int
    username: str
    password: str
    from_email: str
    from_name: str
    security: str


SECRET_FILE_NAMES = {
    "SMTP_HOST": "smtp_host.txt",
    "SMTP_PORT": "smtp_port.txt",
    "SMTP_USERNAME": "smtp_username.txt",
    "SMTP_PASSWORD": "smtp_password.txt",
    "SMTP_FROM": "mail_from.txt",
    "SMTP_FROM_NAME": "mail_from_name.txt",
    "SMTP_SECURITY": "smtp_security.txt",
}

SMTP_JSON_FILE_NAME = "smtp.json"
SMTP_JSON_KEYS = {
    "SMTP_HOST": "host",
    "SMTP_PORT": "port",
    "SMTP_USERNAME": "username",
    "SMTP_PASSWORD": "password",
    "SMTP_FROM": "from",
    "SMTP_FROM_NAME": "fromName",
    "SMTP_SECURITY": "security",
}


def send_rejection_notice(
    *,
    app_config: dict[str, Any],
    secret_dir: Path,
    recipient: str,
    title: str,
    review_note: str,
) -> dict[str, str]:
    if not recipient:
        return {"status": "skipped", "reason": "no_feedback_email"}

    try:
        smtp_config = load_smtp_config(app_config, secret_dir)
        if smtp_config is None:
            return {"status": "skipped", "reason": "not_configured"}
        send_email(smtp_config, build_rejection_message(smtp_config, recipient, title, review_note))
        return {"status": "sent"}
    except Exception as exc:  # noqa: BLE001 - 邮件失败不能阻塞驳回
        return {
            "status": "failed",
            "reason": "send_failed",
            "message": safe_error_message(exc),
        }


def load_smtp_config(app_config: dict[str, Any], secret_dir: Path) -> SmtpConfig | None:
    host = read_config_value(app_config, secret_dir, "SMTP_HOST")
    port_text = read_config_value(app_config, secret_dir, "SMTP_PORT")
    username = read_config_value(app_config, secret_dir, "SMTP_USERNAME")
    password = read_config_value(app_config, secret_dir, "SMTP_PASSWORD")
    from_email = read_config_value(app_config, secret_dir, "SMTP_FROM") or username
    from_name = (
        read_config_value(app_config, secret_dir, "SMTP_FROM_NAME")
        or config.DEFAULT_MAIL_FROM_NAME
    )
    security = (
        read_config_value(app_config, secret_dir, "SMTP_SECURITY")
        or config.DEFAULT_SMTP_SECURITY
    ).lower()

    if not any([host, port_text, username, password]):
        return None
    if not all([host, port_text, username, password, from_email]):
        return None

    try:
        port = int(port_text)
    except (TypeError, ValueError) as exc:
        raise MailConfigError("SMTP_PORT must be an integer") from exc

    if security not in {"ssl", "starttls", "none"}:
        raise MailConfigError("SMTP_SECURITY must be ssl, starttls, or none")

    return SmtpConfig(
        host=host,
        port=port,
        username=username,
        password=password,
        from_email=from_email,
        from_name=from_name,
        security=security,
    )


def read_config_value(app_config: dict[str, Any], secret_dir: Path, key: str) -> str:
    value = app_config.get(key)
    if value:
        return str(value).strip()

    json_values = read_smtp_json(secret_dir)
    json_key = SMTP_JSON_KEYS.get(key)
    if json_key:
        json_value = json_values.get(json_key)
        if json_value:
            return str(json_value).strip()

    file_name = SECRET_FILE_NAMES.get(key)
    if not file_name:
        return ""
    file_path = secret_dir / file_name
    if not file_path.exists():
        return ""
    return file_path.read_text(encoding="utf-8").strip()


def read_smtp_json(secret_dir: Path) -> dict[str, Any]:
    file_path = secret_dir / SMTP_JSON_FILE_NAME
    if not file_path.exists():
        return {}

    try:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise MailConfigError("smtp.json must be valid JSON") from exc

    if not isinstance(payload, dict):
        raise MailConfigError("smtp.json must contain a JSON object")

    return payload


def build_rejection_message(
    smtp_config: SmtpConfig,
    recipient: str,
    title: str,
    review_note: str,
) -> EmailMessage:
    note = review_note or "管理员未填写具体审阅意见。"
    message = EmailMessage()
    message["Subject"] = f"宏伟宝库投稿未通过：{title}"
    message["From"] = formataddr((smtp_config.from_name, smtp_config.from_email))
    message["To"] = recipient
    message.set_content(
        "\n".join(
            [
                f"你的投稿「{title}」未通过审核。",
                "",
                "审阅意见：",
                note,
                "",
                "你可以根据意见修改后重新提交。",
            ]
        )
    )
    return message


def send_email(smtp_config: SmtpConfig, message: EmailMessage) -> None:
    context = ssl.create_default_context()
    if smtp_config.security == "ssl":
        with smtplib.SMTP_SSL(
            smtp_config.host,
            smtp_config.port,
            timeout=20,
            context=context,
        ) as smtp:
            smtp.login(smtp_config.username, smtp_config.password)
            smtp.send_message(message)
        return

    with smtplib.SMTP(smtp_config.host, smtp_config.port, timeout=20) as smtp:
        if smtp_config.security == "starttls":
            smtp.starttls(context=context)
        smtp.login(smtp_config.username, smtp_config.password)
        smtp.send_message(message)


def safe_error_message(exc: Exception) -> str:
    text = str(exc).strip()
    if not text:
        text = exc.__class__.__name__
    return text[:200]
