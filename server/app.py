from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

from flask import Flask, jsonify, request, send_from_directory, session
from werkzeug.utils import secure_filename

from server import config


ROOT_DIR = config.ROOT_DIR
DEFAULT_RUNTIME_DIR = config.RUNTIME_DIR
DEFAULT_ENTRIES_FILE = config.ENTRIES_FILE
DEFAULT_COVERS_DIR = config.COVERS_DIR
DEFAULT_SECRETS_DIR = config.SECRETS_DIR
DEFAULT_ADMIN_PASSWORD_FILE = config.ADMIN_PASSWORD_FILE
DEFAULT_SESSION_SECRET_FILE = config.SESSION_SECRET_FILE
ALLOWED_IMAGE_EXTENSIONS = set(config.ALLOWED_IMAGE_EXTENSIONS)
MAX_CONTENT_LENGTH = config.MAX_CONTENT_LENGTH


class ValidationError(ValueError):
    """Raised when request data does not match the expected shape."""


def create_app(test_config: dict[str, Any] | None = None) -> Flask:
    app = Flask(__name__)
    app.config.from_mapping(
        TESTING=False,
        RUNTIME_DIR=str(DEFAULT_RUNTIME_DIR),
        ENTRIES_FILE=str(DEFAULT_ENTRIES_FILE),
        COVERS_DIR=str(DEFAULT_COVERS_DIR),
        ADMIN_PASSWORD_FILE=str(DEFAULT_ADMIN_PASSWORD_FILE),
        SESSION_SECRET_FILE=str(DEFAULT_SESSION_SECRET_FILE),
        ADMIN_PASSWORD=os.getenv("MARKETPLACE_ADMIN_PASSWORD"),
        SESSION_SECRET=os.getenv("MARKETPLACE_SESSION_SECRET"),
        COVER_URL_PREFIX=config.COVER_URL_PREFIX,
        MAX_CONTENT_LENGTH=MAX_CONTENT_LENGTH,
        SESSION_COOKIE_NAME=config.SESSION_COOKIE_NAME,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE=config.SESSION_COOKIE_SAMESITE,
        SESSION_COOKIE_SECURE=False,
    )

    if test_config:
        app.config.update(test_config)

    app.config["RUNTIME_DIR"] = str(Path(app.config["RUNTIME_DIR"]).resolve())
    app.config["ENTRIES_FILE"] = str(Path(app.config["ENTRIES_FILE"]).resolve())
    app.config["COVERS_DIR"] = str(Path(app.config["COVERS_DIR"]).resolve())
    app.config["ADMIN_PASSWORD_FILE"] = str(
        Path(app.config["ADMIN_PASSWORD_FILE"]).resolve()
    )
    app.config["SESSION_SECRET_FILE"] = str(
        Path(app.config["SESSION_SECRET_FILE"]).resolve()
    )

    ensure_runtime_layout(app)
    app.secret_key = load_session_secret(app)

    @app.errorhandler(ValidationError)
    def handle_validation_error(error: ValidationError):
        return jsonify({"error": str(error)}), 400

    @app.get("/api/health")
    def health_check():
        return jsonify({"ok": True})

    @app.get("/api/public/entries")
    def public_entries():
        return jsonify({"entries": load_entries(app)})

    @app.get("/api/public/tags")
    def public_tags():
        return jsonify(build_tag_counts(load_entries(app)))

    @app.get("/api/public/bootstrap")
    def public_bootstrap():
        entries = load_entries(app)
        return jsonify({"entries": entries, "tags": build_tag_counts(entries)})

    @app.get("/api/public/likes")
    def public_likes():
        ip_hash = get_client_ip_hash()
        entries = load_entries(app)
        liked_ids = [entry["id"] for entry in entries if ip_hash in entry.get("likedBy", [])]
        return jsonify({"likedEntryIds": liked_ids})

    @app.post("/api/public/like/<entry_id>")
    def toggle_like(entry_id: str):
        ip_hash = get_client_ip_hash()
        if not ip_hash:
            raise ValidationError("unable to identify client")

        entries = load_entries(app)
        index, entry = find_entry(entries, entry_id)

        liked_by = entry.get("likedBy", [])
        if not isinstance(liked_by, list):
            liked_by = []

        if ip_hash in liked_by:
            liked_by.remove(ip_hash)
            liked = False
        else:
            liked_by.append(ip_hash)
            liked = True

        new_count = len(liked_by)
        entry["likedBy"] = liked_by
        entry["likeCount"] = new_count
        save_entries(app, entries)

        return jsonify({"liked": liked, "likeCount": new_count})

    @app.get("/api/admin/session")
    def admin_session():
        return jsonify({"authenticated": bool(session.get("is_admin"))})

    @app.post("/api/admin/login")
    def admin_login():
        payload = request.get_json(silent=True) or {}
        password = str(payload.get("password", ""))
        expected_password = load_admin_password(app)

        if not expected_password:
            raise ValidationError("admin password is not configured")

        if not hmac.compare_digest(password, expected_password):
            return jsonify({"error": "invalid password"}), 401

        session.clear()
        session["is_admin"] = True
        session["loginAt"] = now_iso()
        return jsonify({"authenticated": True})

    @app.post("/api/admin/logout")
    @require_admin_session
    def admin_logout():
        session.clear()
        return jsonify({"authenticated": False})

    @app.get("/api/admin/entries")
    @require_admin_session
    def admin_entries():
        return jsonify({"entries": load_entries(app)})

    @app.post("/api/admin/entries")
    @require_admin_session
    def create_entry():
        payload = request.get_json(silent=True) or {}
        entries = load_entries(app)
        existing_ids = {entry["id"] for entry in entries}
        entry = normalize_entry(
            payload,
            cover_url_prefix=app.config["COVER_URL_PREFIX"],
            existing_ids=existing_ids,
        )
        entries.append(entry)
        save_entries(app, entries)
        return jsonify({"entry": entry}), 201

    @app.put("/api/admin/entries/<entry_id>")
    @require_admin_session
    def update_entry(entry_id: str):
        payload = request.get_json(silent=True) or {}
        entries = load_entries(app)
        index, current_entry = find_entry(entries, entry_id)
        normalized = normalize_entry(
            payload,
            cover_url_prefix=app.config["COVER_URL_PREFIX"],
            existing_ids={entry["id"] for entry in entries if entry["id"] != entry_id},
            current_entry=current_entry,
        )
        entries[index] = normalized
        save_entries(app, entries)
        return jsonify({"entry": normalized})

    @app.delete("/api/admin/entries/<entry_id>")
    @require_admin_session
    def delete_entry(entry_id: str):
        entries = load_entries(app)
        index, current_entry = find_entry(entries, entry_id)
        entries.pop(index)
        save_entries(app, entries)
        delete_cover_file(app, current_entry.get("coverPath", ""))
        return jsonify({"deletedId": entry_id})

    @app.post("/api/admin/entries/import")
    @require_admin_session
    def import_entries():
        payload = request.get_json(silent=True) or {}
        incoming = payload.get("entries")
        if not isinstance(incoming, list):
            raise ValidationError("entries must be an array")
        existing_ids = set()
        normalized = []
        for item in incoming:
            item = item if isinstance(item, dict) else {}
            entry = normalize_entry(
                item,
                cover_url_prefix=app.config["COVER_URL_PREFIX"],
                existing_ids=existing_ids,
            )
            # 保留原条目的时间戳
            original_created = normalize_optional_text(item.get("createdAt"))
            if original_created:
                entry["createdAt"] = original_created
            original_updated = normalize_optional_text(item.get("updatedAt"))
            if original_updated:
                entry["updatedAt"] = original_updated
            normalized.append(entry)
            existing_ids.add(entry["id"])
        save_entries(app, normalized)
        return jsonify({"imported": len(normalized)})

    @app.post("/api/admin/covers")
    @require_admin_session
    def upload_cover():
        file_storage = request.files.get("file")
        if file_storage is None or not file_storage.filename:
            raise ValidationError("cover file is required")

        original_name = secure_filename(file_storage.filename)
        suffix = Path(original_name).suffix.lower()
        if suffix not in ALLOWED_IMAGE_EXTENSIONS:
            raise ValidationError("unsupported cover file type")

        filename = f"cover_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}_{uuid4().hex[:8]}{suffix}"
        destination = Path(app.config["COVERS_DIR"]) / filename
        file_storage.save(destination)

        return (
            jsonify(
                {
                    "fileName": filename,
                    "coverPath": build_cover_url(app.config["COVER_URL_PREFIX"], filename),
                }
            ),
            201,
        )

    # ── 开发环境：serve 前端静态文件与封面 ──
    frontend_dir = ROOT_DIR / "frontend"

    @app.route("/")
    @app.route("/the-great-vault/")
    def serve_index():
        return send_from_directory(str(frontend_dir), "index.html")

    @app.route("/the-great-vault/admin/")
    @app.route("/admin/")
    def serve_admin():
        return send_from_directory(str(frontend_dir / "admin"), "index.html")

    @app.route("/the-great-vault/covers/<path:filename>")
    def serve_cover(filename: str):
        return send_from_directory(str(Path(app.config["COVERS_DIR"])), filename)

    return app


def require_admin_session(view_func):
    @wraps(view_func)
    def wrapped(*args, **kwargs):
        if not session.get("is_admin"):
            return jsonify({"error": "admin auth required"}), 401
        return view_func(*args, **kwargs)

    return wrapped


def ensure_runtime_layout(app: Flask) -> None:
    runtime_dir = Path(app.config["RUNTIME_DIR"])
    entries_file = Path(app.config["ENTRIES_FILE"])
    covers_dir = Path(app.config["COVERS_DIR"])
    admin_password_file = Path(app.config["ADMIN_PASSWORD_FILE"])
    session_secret_file = Path(app.config["SESSION_SECRET_FILE"])

    runtime_dir.mkdir(parents=True, exist_ok=True)
    covers_dir.mkdir(parents=True, exist_ok=True)
    admin_password_file.parent.mkdir(parents=True, exist_ok=True)
    session_secret_file.parent.mkdir(parents=True, exist_ok=True)

    if not entries_file.exists():
        atomic_write_json(entries_file, {"entries": []})


def load_admin_password(app: Flask) -> str | None:
    inline_password = app.config.get("ADMIN_PASSWORD")
    if inline_password:
        return str(inline_password)

    password_file = Path(app.config["ADMIN_PASSWORD_FILE"])
    if password_file.exists():
        return password_file.read_text(encoding="utf-8").strip()

    return None


def load_session_secret(app: Flask) -> str:
    inline_secret = app.config.get("SESSION_SECRET")
    if inline_secret:
        return str(inline_secret)

    secret_file = Path(app.config["SESSION_SECRET_FILE"])
    if secret_file.exists():
        secret_text = secret_file.read_text(encoding="utf-8").strip()
        if secret_text:
            return secret_text

    if app.config.get("TESTING"):
        return "test-session-secret"

    raise RuntimeError(
        "session secret is not configured; set MARKETPLACE_SESSION_SECRET or create "
        f"{secret_file}"
    )


def load_entries(app: Flask) -> list[dict[str, Any]]:
    entries_file = Path(app.config["ENTRIES_FILE"])
    raw_data = json.loads(entries_file.read_text(encoding="utf-8"))
    entries = raw_data.get("entries")
    if not isinstance(entries, list):
        raise RuntimeError("entries.json must contain an 'entries' array")
    for entry in entries:
        if "likeCount" not in entry:
            entry["likeCount"] = 0
        if "likedBy" not in entry:
            entry["likedBy"] = []
    return entries


def save_entries(app: Flask, entries: list[dict[str, Any]]) -> None:
    atomic_write_json(Path(app.config["ENTRIES_FILE"]), {"entries": entries})


def get_client_ip_hash() -> str:
    from flask import request

    forwarded = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
    ip = forwarded or request.remote_addr or ""
    if not ip:
        return ""
    return hashlib.sha256(f"{config.LIKE_HASH_SALT}{ip}".encode()).hexdigest()[:config.LIKE_HASH_LENGTH]


def atomic_write_json(target_path: Path, payload: dict[str, Any]) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, indent=config.JSON_INDENT) + "\n"

    tmp_path = target_path.with_suffix(target_path.suffix + ".tmp")
    try:
        tmp_path.write_text(serialized, encoding="utf-8")
        tmp_path.replace(target_path)
    except (PermissionError, OSError):
        target_path.write_text(serialized, encoding="utf-8")
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


def normalize_entry(
    payload: dict[str, Any],
    *,
    cover_url_prefix: str,
    existing_ids: set[str],
    current_entry: dict[str, Any] | None = None,
) -> dict[str, Any]:
    title = normalize_required_text(payload.get("title"), "title")
    author = normalize_optional_text(payload.get("author"))
    content_tags = normalize_tags(payload.get("contentTags"), required=False)
    flavor_tags = normalize_tags(payload.get("flavorTags"), required=False)
    recommend_value = normalize_recommend_value(payload.get("recommendValue"))
    summary = normalize_optional_text(payload.get("summary"))
    target_url = normalize_external_url(payload.get("targetUrl"))
    cover_path = normalize_cover_path(payload.get("coverPath"), cover_url_prefix)

    if current_entry:
        entry_id = current_entry["id"]
        created_at = current_entry.get("createdAt", now_iso())
    else:
        requested_id = normalize_optional_text(payload.get("id"))
        entry_id = requested_id or generate_entry_id(existing_ids)
        if entry_id in existing_ids:
            raise ValidationError("entry id already exists")
        created_at = now_iso()

    return {
        "id": entry_id,
        "title": title,
        "author": author,
        "contentTags": content_tags,
        "flavorTags": flavor_tags,
        "recommendValue": recommend_value,
        "likeCount": 0 if current_entry is None else current_entry.get("likeCount", 0),
        "likedBy": [] if current_entry is None else current_entry.get("likedBy", []),
        "summary": summary,
        "coverPath": cover_path,
        "targetUrl": target_url,
        "createdAt": created_at,
        "updatedAt": now_iso(),
    }


def normalize_required_text(value: Any, field_name: str) -> str:
    text = normalize_optional_text(value)
    if not text:
        raise ValidationError(f"{field_name} is required")
    return text


def normalize_optional_text(value: Any) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        value = str(value)
    return re.sub(r"[ \t]+", " ", value).strip()


def normalize_tags(value: Any, *, required: bool) -> list[str]:
    if value is None:
        tags: list[Any] = []
    elif isinstance(value, list):
        tags = value
    else:
        raise ValidationError("tags must be provided as an array")

    normalized: list[str] = []
    seen: set[str] = set()
    for raw_tag in tags:
        tag = normalize_optional_text(raw_tag)
        if not tag:
            continue
        if tag in seen:
            continue
        seen.add(tag)
        normalized.append(tag)

    if required and not normalized:
        raise ValidationError("at least one content tag is required")

    return normalized


def normalize_recommend_value(value: Any) -> int:
    if value is None or value == "":
        return 0

    try:
        normalized = int(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError("recommendValue must be an integer") from exc

    if normalized < 0:
        raise ValidationError("recommendValue must be greater than or equal to 0")

    return normalized


def normalize_external_url(value: Any) -> str:
    url = normalize_required_text(value, "targetUrl")
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValidationError("targetUrl must be a valid http or https URL")
    return url


def normalize_cover_path(value: Any, cover_url_prefix: str) -> str:
    cover_path = normalize_optional_text(value)
    if not cover_path:
        return ""
    normalized_prefix = cover_url_prefix.rstrip("/") + "/"
    if not cover_path.startswith(normalized_prefix):
        raise ValidationError("coverPath must use the local cover URL prefix")
    return cover_path


def find_entry(entries: list[dict[str, Any]], entry_id: str) -> tuple[int, dict[str, Any]]:
    for index, entry in enumerate(entries):
        if entry.get("id") == entry_id:
            return index, entry
    raise ValidationError("entry not found")


def build_tag_counts(entries: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    return {
        "contentTags": count_tags(entries, "contentTags"),
        "flavorTags": count_tags(entries, "flavorTags"),
    }


def count_tags(entries: list[dict[str, Any]], field_name: str) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    for entry in entries:
        for tag in entry.get(field_name, []):
            counts[tag] = counts.get(tag, 0) + 1

    sorted_pairs = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return [{"tag": tag, "count": count} for tag, count in sorted_pairs]


def build_cover_url(cover_url_prefix: str, filename: str) -> str:
    return f"{cover_url_prefix.rstrip('/')}/{filename}"


def delete_cover_file(app: Flask, cover_path: str) -> None:
    if not cover_path:
        return

    filename = Path(urlparse(cover_path).path).name
    if not filename:
        return

    covers_dir = Path(app.config["COVERS_DIR"]).resolve()
    candidate = (covers_dir / filename).resolve()
    if candidate.parent != covers_dir:
        raise ValidationError("resolved cover file is outside covers directory")

    if candidate.exists():
        candidate.unlink()


def generate_entry_id(existing_ids: set[str]) -> str:
    while True:
        candidate = f"{config.ENTRY_ID_PREFIX}{uuid4().hex[:config.ENTRY_ID_HEX_LENGTH]}"
        if candidate not in existing_ids:
            return candidate


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


if __name__ == "__main__":
    create_app().run(debug=True)
