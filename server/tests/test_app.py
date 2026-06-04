from __future__ import annotations

import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from server.app import create_app


class MarketplaceServerTestCase(unittest.TestCase):
    def setUp(self) -> None:
        temp_parent = Path(__file__).resolve().parent / ".tmp"
        temp_parent.mkdir(parents=True, exist_ok=True)
        base_dir = temp_parent / f"case_{uuid4().hex}"
        base_dir.mkdir(parents=True, exist_ok=False)
        self.base_dir = base_dir
        self.runtime_dir = base_dir / "runtime"
        self.entries_file = self.runtime_dir / "entries.json"
        self.covers_dir = self.runtime_dir / "covers"
        self.secrets_dir = self.runtime_dir / "secrets"

        self.app = create_app(
            {
                "TESTING": True,
                "RUNTIME_DIR": str(self.runtime_dir),
                "ENTRIES_FILE": str(self.entries_file),
                "COVERS_DIR": str(self.covers_dir),
                "ADMIN_PASSWORD_FILE": str(self.secrets_dir / "admin_password.txt"),
                "SESSION_SECRET_FILE": str(self.secrets_dir / "session_secret.txt"),
                "ADMIN_PASSWORD": "test-password",
                "SESSION_SECRET": "test-session-secret",
                "COVER_URL_PREFIX": "/the-great-vault/covers",
            }
        )
        self.client = self.app.test_client()

    def tearDown(self) -> None:
        # 当前本地环境会阻止 Python 删除工作区文件，测试目录留给 .gitignore 处理。
        pass

    def login(self) -> None:
        response = self.client.post(
            "/api/admin/login", json={"password": "test-password"}
        )
        self.assertEqual(response.status_code, 200)

    def test_health_check(self) -> None:
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"ok": True})

    def test_public_bootstrap_works_with_empty_data(self) -> None:
        response = self.client.get("/api/public/bootstrap")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["entries"], [])

    def test_login_and_session(self) -> None:
        response = self.client.post(
            "/api/admin/login", json={"password": "wrong-password"}
        )
        self.assertEqual(response.status_code, 401)

        self.login()
        session_response = self.client.get("/api/admin/session")
        self.assertEqual(session_response.get_json(), {"authenticated": True})

    def test_create_entry_normalizes_tags(self) -> None:
        self.login()
        payload = {
            "title": "黑潮边境",
            "author": "某作者",
            "contentTags": [" 模组 ", "敌人", "敌人"],
            "flavorTags": [" 西幻 ", "  "],
            "recommendValue": "1",
            "summary": " 适合短团的边境探索模组。 ",
            "coverPath": "/marketplace/covers/demo-cover.svg",
            "targetUrl": "https://example.com/module",
        }

        response = self.client.post("/api/admin/entries", json=payload)
        self.assertEqual(response.status_code, 201)

        entry = response.get_json()["entry"]
        self.assertEqual(entry["contentTags"], ["模组", "敌人"])
        self.assertEqual(entry["flavorTags"], ["西幻"])
        self.assertEqual(entry["recommendValue"], 1)
        self.assertEqual(entry["summary"], "适合短团的边境探索模组。")

    def test_upload_cover_and_delete_entry(self) -> None:
        self.login()

        upload_response = self.client.post(
            "/api/admin/covers",
            data={"file": (io.BytesIO(b"<svg></svg>"), "cover.svg")},
            content_type="multipart/form-data",
        )
        self.assertEqual(upload_response.status_code, 201)
        cover_path = upload_response.get_json()["coverPath"]
        cover_filename = cover_path.rsplit("/", 1)[-1]
        self.assertTrue((self.covers_dir / cover_filename).exists())

        create_response = self.client.post(
            "/api/admin/entries",
            json={
                "title": "赤铁旅团",
                "author": "测试作者",
                "contentTags": ["模组"],
                "flavorTags": [],
                "recommendValue": 0,
                "summary": "",
                "coverPath": cover_path,
                "targetUrl": "https://example.com/entry",
            },
        )
        self.assertEqual(create_response.status_code, 201)
        entry_id = create_response.get_json()["entry"]["id"]

        with patch("pathlib.Path.unlink") as mocked_unlink:
            delete_response = self.client.delete(f"/api/admin/entries/{entry_id}")
        self.assertEqual(delete_response.status_code, 200)
        mocked_unlink.assert_called_once()

    def test_tag_counts_are_aggregated(self) -> None:
        data = {
            "entries": [
                {
                    "id": "dhm_001",
                    "title": "A",
                    "author": "A",
                    "contentTags": ["模组", "敌人"],
                    "flavorTags": ["西幻"],
                    "recommendValue": 1,
                    "summary": "",
                    "coverPath": "/marketplace/covers/a.svg",
                    "targetUrl": "https://example.com/a",
                    "createdAt": "2026-06-02T00:00:00+00:00",
                    "updatedAt": "2026-06-02T00:00:00+00:00",
                },
                {
                    "id": "dhm_002",
                    "title": "B",
                    "author": "B",
                    "contentTags": ["模组"],
                    "flavorTags": ["西幻", "武侠"],
                    "recommendValue": 0,
                    "summary": "",
                    "coverPath": "/marketplace/covers/b.svg",
                    "targetUrl": "https://example.com/b",
                    "createdAt": "2026-06-02T00:00:00+00:00",
                    "updatedAt": "2026-06-02T00:00:00+00:00",
                },
            ]
        }
        self.entries_file.parent.mkdir(parents=True, exist_ok=True)
        self.entries_file.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        response = self.client.get("/api/public/tags")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["contentTags"][0], {"tag": "模组", "count": 2})
        self.assertEqual(payload["flavorTags"][0], {"tag": "西幻", "count": 2})

    def test_like_toggle_creates_entry_and_unlikes(self) -> None:
        self.login()
        create_response = self.client.post(
            "/api/admin/entries",
            json={
                "title": "测试条目",
                "author": "测试",
                "contentTags": ["模组"],
                "flavorTags": [],
                "recommendValue": 0,
                "summary": "",
                "coverPath": "/marketplace/covers/test.svg",
                "targetUrl": "https://example.com/test",
            },
        )
        entry_id = create_response.get_json()["entry"]["id"]

        response = self.client.post(f"/api/public/like/{entry_id}")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["liked"])
        self.assertEqual(data["likeCount"], 1)

        bootstrap = self.client.get("/api/public/bootstrap")
        entry = next(e for e in bootstrap.get_json()["entries"] if e["id"] == entry_id)
        self.assertEqual(entry["likeCount"], 1)

        likes_resp = self.client.get("/api/public/likes")
        self.assertIn(entry_id, likes_resp.get_json()["likedEntryIds"])

        response2 = self.client.post(f"/api/public/like/{entry_id}")
        self.assertEqual(response2.status_code, 200)
        data2 = response2.get_json()
        self.assertFalse(data2["liked"])
        self.assertEqual(data2["likeCount"], 0)

        likes_resp2 = self.client.get("/api/public/likes")
        self.assertNotIn(entry_id, likes_resp2.get_json()["likedEntryIds"])

    def test_like_nonexistent_entry_returns_error(self) -> None:
        response = self.client.post("/api/public/like/dhm_nonexistent")
        self.assertEqual(response.status_code, 400)

    def test_delete_entry_cleans_up_likes(self) -> None:
        self.login()
        create_response = self.client.post(
            "/api/admin/entries",
            json={
                "title": "待删条目",
                "author": "测试",
                "contentTags": [],
                "flavorTags": [],
                "recommendValue": 0,
                "summary": "",
                "coverPath": "/marketplace/covers/del.svg",
                "targetUrl": "https://example.com/del",
            },
        )
        entry_id = create_response.get_json()["entry"]["id"]

        self.client.post(f"/api/public/like/{entry_id}")

        with patch("pathlib.Path.unlink"):
            delete_response = self.client.delete(f"/api/admin/entries/{entry_id}")
        self.assertEqual(delete_response.status_code, 200)

        bootstrap = self.client.get("/api/public/bootstrap")
        entry_ids = [e["id"] for e in bootstrap.get_json()["entries"]]
        self.assertNotIn(entry_id, entry_ids)

    def test_public_bootstrap_includes_like_count(self) -> None:
        self.login()
        self.client.post(
            "/api/admin/entries",
            json={
                "title": "带赞条目",
                "author": "测试",
                "contentTags": [],
                "flavorTags": [],
                "recommendValue": 0,
                "summary": "",
                "coverPath": "/marketplace/covers/like_test.svg",
                "targetUrl": "https://example.com/like_test",
            },
        )

        bootstrap = self.client.get("/api/public/bootstrap")
        entries = bootstrap.get_json()["entries"]
        for entry in entries:
            self.assertIn("likeCount", entry)
            self.assertIsInstance(entry["likeCount"], int)
            self.assertIn("likedBy", entry)
            self.assertIsInstance(entry["likedBy"], list)


if __name__ == "__main__":
    unittest.main()
