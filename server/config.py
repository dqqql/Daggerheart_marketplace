from __future__ import annotations

from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent

# ── 运行时路径 ──
RUNTIME_DIR = ROOT_DIR / "data" / "runtime"
ENTRIES_FILE = RUNTIME_DIR / "entries.json"
COVERS_DIR = RUNTIME_DIR / "covers"
SECRETS_DIR = RUNTIME_DIR / "secrets"
ADMIN_PASSWORD_FILE = SECRETS_DIR / "admin_password.txt"
SESSION_SECRET_FILE = SECRETS_DIR / "session_secret.txt"

# ── 上传限制 ──
ALLOWED_IMAGE_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"})
MAX_CONTENT_LENGTH = 8 * 1024 * 1024  # 8 MB

# ── URL 前缀 ──
COVER_URL_PREFIX = "/the-great-vault/covers"

# ── 会话 ──
SESSION_COOKIE_NAME = "dh_market_admin"
SESSION_COOKIE_SAMESITE = "Lax"

# ── 点赞 ──
LIKE_HASH_SALT = "dh_like_"
LIKE_HASH_LENGTH = 16

# ── 条目 ID ──
ENTRY_ID_PREFIX = "dhm_"
ENTRY_ID_HEX_LENGTH = 8

# ── JSON 格式化 ──
JSON_INDENT = 2
