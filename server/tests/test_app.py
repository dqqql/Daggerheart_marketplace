from __future__ import annotations

import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from server.app import create_app
from server.mailer import load_smtp_config, send_rejection_notice


class MarketplaceServerTestCase(unittest.TestCase):
    def setUp(self) -> None:
        temp_parent = Path(__file__).resolve().parent / ".tmp"
        temp_parent.mkdir(parents=True, exist_ok=True)
        base_dir = temp_parent / f"case_{uuid4().hex}"
        base_dir.mkdir(parents=True, exist_ok=False)
        self.base_dir = base_dir
        self.runtime_dir = base_dir / "runtime"
        self.entries_file = self.runtime_dir / "entries.json"
        self.submissions_file = self.runtime_dir / "submissions.json"
        self.submission_reviews_file = self.runtime_dir / "submission_reviews.json"
        self.covers_dir = self.runtime_dir / "covers"
        self.pending_covers_dir = self.covers_dir / "pending"
        self.secrets_dir = self.runtime_dir / "secrets"

        self.app = create_app(
            {
                "TESTING": True,
                "RUNTIME_DIR": str(self.runtime_dir),
                "ENTRIES_FILE": str(self.entries_file),
                "SUBMISSIONS_FILE": str(self.submissions_file),
                "SUBMISSION_REVIEWS_FILE": str(self.submission_reviews_file),
                "COVERS_DIR": str(self.covers_dir),
                "PENDING_COVERS_DIR": str(self.pending_covers_dir),
                "SECRETS_DIR": str(self.secrets_dir),
                "ADMIN_PASSWORD_FILE": str(self.secrets_dir / "admin_password.txt"),
                "SESSION_SECRET_FILE": str(self.secrets_dir / "session_secret.txt"),
                "ADMIN_PASSWORD": "test-password",
                "SESSION_SECRET": "test-session-secret",
                "COVER_URL_PREFIX": "/the-great-vault/covers",
                "PENDING_COVER_URL_PREFIX": "/the-great-vault/covers/pending",
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
            "coverPath": "/the-great-vault/covers/demo-cover.svg",
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
                    "coverPath": "/the-great-vault/covers/a.svg",
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
                    "coverPath": "/the-great-vault/covers/b.svg",
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
                "coverPath": "/the-great-vault/covers/test.svg",
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
                "coverPath": "/the-great-vault/covers/del.svg",
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

    def test_reject_published_entry_without_feedback_email(self) -> None:
        self.login()
        create_response = self.client.post(
            "/api/admin/entries",
            json={
                "title": "旧资源",
                "author": "测试",
                "contentTags": [],
                "flavorTags": [],
                "recommendValue": 0,
                "summary": "",
                "coverPath": "",
                "targetUrl": "https://example.com/legacy",
            },
        )
        entry_id = create_response.get_json()["entry"]["id"]

        reject_response = self.client.post(
            f"/api/admin/entries/{entry_id}/reject",
            json={"reviewNote": "需要重新整理授权说明。"},
        )

        self.assertEqual(reject_response.status_code, 200)
        self.assertEqual(
            reject_response.get_json()["notification"],
            {"status": "skipped", "reason": "no_feedback_email"},
        )
        entries_after = self.client.get("/api/admin/entries").get_json()["entries"]
        self.assertFalse(any(e["id"] == entry_id for e in entries_after))
        reviews = self.client.get("/api/admin/submission-reviews").get_json()["reviews"]
        rejected = next(r for r in reviews if r["action"] == "entry_rejected")
        self.assertEqual(rejected["entryId"], entry_id)
        self.assertEqual(rejected["reviewNote"], "需要重新整理授权说明。")

    def test_edit_published_entry_email_then_reject_sends_notice(self) -> None:
        sent: list[dict[str, str]] = []

        def fake_mailer(**kwargs):
            sent.append(kwargs)
            return {"status": "sent"}

        self.app.config["MAIL_SENDER"] = fake_mailer
        self.login()
        create_response = self.client.post(
            "/api/admin/entries",
            json={
                "title": "可补邮箱资源",
                "author": "测试",
                "contentTags": [],
                "flavorTags": [],
                "recommendValue": 0,
                "summary": "",
                "coverPath": "",
                "targetUrl": "https://example.com/can-email",
            },
        )
        entry_id = create_response.get_json()["entry"]["id"]

        edit_response = self.client.put(
            f"/api/admin/entries/{entry_id}",
            json={
                "title": "可补邮箱资源",
                "author": "测试",
                "contentTags": [],
                "flavorTags": [],
                "recommendValue": 0,
                "summary": "",
                "coverPath": "",
                "targetUrl": "https://example.com/can-email",
                "feedbackEmail": " Owner@Example.COM ",
            },
        )
        self.assertEqual(edit_response.status_code, 200)
        self.assertEqual(edit_response.get_json()["entry"]["feedbackEmail"], "owner@example.com")

        reject_response = self.client.post(
            f"/api/admin/entries/{entry_id}/reject",
            json={"reviewNote": "经复核需要调整授权说明。"},
        )

        self.assertEqual(reject_response.status_code, 200)
        self.assertEqual(reject_response.get_json()["notification"], {"status": "sent"})
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]["recipient"], "owner@example.com")
        self.assertEqual(sent[0]["notice_type"], "published_rejected")
        self.assertEqual(sent[0]["review_note"], "经复核需要调整授权说明。")

    def test_submit_entry_success(self) -> None:
        """匿名提交合法条目 → 201，数据写入 submissions，不进入 entries。"""
        payload = {
            "title": "社区投稿模组",
            "author": "社区作者",
            "feedbackEmail": " Creator@Example.COM ",
            "contentTags": ["模组", "探索"],
            "flavorTags": ["克苏鲁"],
            "summary": "一个由社区提交的模组。",
            "coverPath": "",
            "targetUrl": "https://example.com/community-module",
        }

        response = self.client.post("/api/public/submissions", json=payload)
        self.assertEqual(response.status_code, 201, response.get_json())

        # 投稿不应进入公开条目
        entries_resp = self.client.get("/api/public/entries")
        self.assertNotIn(
            "社区投稿模组",
            [e["title"] for e in entries_resp.get_json()["entries"]],
        )

        # 管理员登录后可看到待审列表
        self.login()
        submissions_resp = self.client.get("/api/admin/submissions")
        self.assertEqual(submissions_resp.status_code, 200)
        submissions = submissions_resp.get_json()["submissions"]
        self.assertEqual(len(submissions), 1)
        self.assertEqual(submissions[0]["title"], "社区投稿模组")
        self.assertEqual(submissions[0]["feedbackEmail"], "creator@example.com")

    def test_submit_entry_missing_fields(self) -> None:
        """缺标题或缺目标链接 → 400。"""
        # 缺标题
        resp1 = self.client.post(
            "/api/public/submissions",
            json={"author": "test", "targetUrl": "https://example.com"},
        )
        self.assertEqual(resp1.status_code, 400)

        # 缺目标链接
        resp2 = self.client.post(
            "/api/public/submissions",
            json={"title": "test", "author": "test"},
        )
        self.assertEqual(resp2.status_code, 400)

    def test_submit_entry_invalid_feedback_email(self) -> None:
        """反馈邮箱格式明显非法 → 400。"""
        resp = self.client.post(
            "/api/public/submissions",
            json={
                "title": "带错误邮箱的投稿",
                "targetUrl": "https://example.com/bad-email",
                "feedbackEmail": "not-an-email",
            },
        )
        self.assertEqual(resp.status_code, 400)

    def test_submissions_auth_required(self) -> None:
        """所有 admin submissions 端点未登录时返回 401。"""
        # 先提交一条以获取一个存在的 id
        self.client.post(
            "/api/public/submissions",
            json={
                "title": "待审条目",
                "targetUrl": "https://example.com/test",
                "feedbackEmail": "submitter@example.com",
            },
        )
        self.login()
        list_resp = self.client.get("/api/admin/submissions")
        sid = list_resp.get_json()["submissions"][0]["id"]

        # 登出后所有管理端点应拒绝
        self.client.post("/api/admin/logout")

        self.assertEqual(
            self.client.get("/api/admin/submissions").status_code, 401
        )
        self.assertEqual(
            self.client.get("/api/admin/submission-reviews").status_code, 401
        )
        self.assertEqual(
            self.client.put(f"/api/admin/submissions/{sid}", json={"title": "X"}).status_code, 401
        )
        self.assertEqual(
            self.client.post(f"/api/admin/submissions/{sid}/approve").status_code, 401
        )
        self.assertEqual(
            self.client.delete(f"/api/admin/submissions/{sid}").status_code, 401
        )

    def test_admin_list_submissions(self) -> None:
        """登录后 GET /api/admin/submissions 返回待审列表。"""
        self.client.post(
            "/api/public/submissions",
            json={
                "title": "投稿A",
                "targetUrl": "https://example.com/a",
                "feedbackEmail": "a@example.com",
            },
        )
        self.client.post(
            "/api/public/submissions",
            json={
                "title": "投稿B",
                "targetUrl": "https://example.com/b",
                "feedbackEmail": "b@example.com",
            },
        )

        self.login()
        resp = self.client.get("/api/admin/submissions")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertIn("submissions", data)
        self.assertEqual(len(data["submissions"]), 2)
        titles = [s["title"] for s in data["submissions"]]
        self.assertIn("投稿A", titles)
        self.assertIn("投稿B", titles)

    def test_admin_edit_submission(self) -> None:
        """管理员编辑待审条目字段 → 数据更新。"""
        self.client.post(
            "/api/public/submissions",
            json={
                "title": "原始标题",
                "targetUrl": "https://example.com/original",
                "feedbackEmail": "original@example.com",
            },
        )
        self.login()
        submissions = self.client.get("/api/admin/submissions").get_json()["submissions"]
        sid = submissions[0]["id"]

        resp = self.client.put(
            f"/api/admin/submissions/{sid}",
            json={
                "title": "修改后的标题",
                "author": "修改作者",
                "feedbackEmail": "fixed@example.com",
                "targetUrl": "https://example.com/edited",
            },
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["submission"]["title"], "修改后的标题")
        self.assertEqual(resp.get_json()["submission"]["feedbackEmail"], "fixed@example.com")

        # 再次获取确认持久化
        updated = self.client.get("/api/admin/submissions").get_json()["submissions"]
        self.assertEqual(updated[0]["title"], "修改后的标题")

    def test_approve_submission(self) -> None:
        """通过投稿：entries 新增、submissions 移除、封面迁移。"""
        # 上传封面到 pending
        self.login()
        upload_resp = self.client.post(
            "/api/public/covers",
            data={"file": (io.BytesIO(b"<svg></svg>"), "cover.svg")},
            content_type="multipart/form-data",
        )
        self.assertEqual(upload_resp.status_code, 201)
        pending_cover_path = upload_resp.get_json()["coverPath"]
        pending_filename = pending_cover_path.rsplit("/", 1)[-1]

        # 提交投稿（含封面）
        self.client.post(
            "/api/public/submissions",
            json={
                "title": "待通过条目",
                "author": "作者",
                "contentTags": ["模组"],
                "flavorTags": [],
                "summary": "",
                "coverPath": pending_cover_path,
                "targetUrl": "https://example.com/approve-me",
                "feedbackEmail": "submitter@example.com",
            },
        )

        # 获取 submission id
        submissions = self.client.get("/api/admin/submissions").get_json()["submissions"]
        sid = submissions[0]["id"]

        # 通过
        approve_resp = self.client.post(
            f"/api/admin/submissions/{sid}/approve"
        )
        self.assertEqual(approve_resp.status_code, 200)
        self.assertIn("entry", approve_resp.get_json())

        # submissions 应为空
        self.assertEqual(
            len(self.client.get("/api/admin/submissions").get_json()["submissions"]), 0
        )

        # entries 应有一条
        entries = self.client.get("/api/admin/entries").get_json()["entries"]
        approved = next(e for e in entries if e["title"] == "待通过条目")
        self.assertEqual(approved["author"], "作者")
        self.assertEqual(approved["likeCount"], 0)
        self.assertEqual(approved["likedBy"], [])
        self.assertTrue(approved["id"].startswith("dhm_"))
        self.assertEqual(approved["feedbackEmail"], "submitter@example.com")

        bootstrap_entries = self.client.get("/api/public/bootstrap").get_json()["entries"]
        public_entry = next(e for e in bootstrap_entries if e["title"] == "待通过条目")
        self.assertNotIn("feedbackEmail", public_entry)

        # 封面应从 pending 迁移到正式目录
        # pending 目录下不应再有该文件
        pending_file = self.covers_dir / "pending" / pending_filename
        self.assertFalse(pending_file.exists(), "pending cover should be moved")

        # 正式 covers 目录下应有该文件
        final_file = self.covers_dir / pending_filename
        self.assertTrue(final_file.exists(), "cover should be in main covers dir")

        history_resp = self.client.get("/api/admin/submission-reviews")
        self.assertEqual(history_resp.status_code, 200)
        reviews = history_resp.get_json()["reviews"]
        approved_review = next(r for r in reviews if r["action"] == "approved")
        self.assertEqual(approved_review["submissionId"], sid)
        self.assertEqual(approved_review["entryId"], approved["id"])
        self.assertEqual(approved_review["title"], "待通过条目")
        self.assertEqual(approved_review["notification"]["reason"], "not_configured")
        self.assertNotIn("/pending/", approved_review["coverPath"])

    def test_reject_submission(self) -> None:
        """驳回投稿：submissions 移除、pending 封面清理。"""
        # 上传封面到 pending
        self.login()
        upload_resp = self.client.post(
            "/api/public/covers",
            data={"file": (io.BytesIO(b"<svg></svg>"), "reject_cover.svg")},
            content_type="multipart/form-data",
        )
        pending_cover_path = upload_resp.get_json()["coverPath"]
        pending_filename = pending_cover_path.rsplit("/", 1)[-1]

        # 提交投稿
        self.client.post(
            "/api/public/submissions",
            json={
                "title": "待驳回条目",
                "targetUrl": "https://example.com/reject-me",
                "coverPath": pending_cover_path,
                "feedbackEmail": "reject@example.com",
            },
        )
        submissions = self.client.get("/api/admin/submissions").get_json()["submissions"]
        sid = submissions[0]["id"]

        # 驳回
        reject_resp = self.client.delete(f"/api/admin/submissions/{sid}")
        self.assertEqual(reject_resp.status_code, 200)
        self.assertEqual(
            reject_resp.get_json()["notification"],
            {"status": "skipped", "reason": "not_configured"},
        )

        # submissions 应为空
        self.assertEqual(
            len(self.client.get("/api/admin/submissions").get_json()["submissions"]), 0
        )

        # entries 不应增加
        entries = self.client.get("/api/admin/entries").get_json()["entries"]
        self.assertFalse(any(e["title"] == "待驳回条目" for e in entries))

        # pending 封面应被清理
        pending_file = self.covers_dir / "pending" / pending_filename
        self.assertFalse(pending_file.exists(), "pending cover should be deleted on reject")

        history_resp = self.client.get("/api/admin/submission-reviews")
        self.assertEqual(history_resp.status_code, 200)
        reviews = history_resp.get_json()["reviews"]
        rejected_review = next(r for r in reviews if r["action"] == "rejected")
        self.assertEqual(rejected_review["submissionId"], sid)
        self.assertEqual(rejected_review["title"], "待驳回条目")
        self.assertEqual(
            rejected_review["notification"],
            {"status": "skipped", "reason": "not_configured"},
        )

    def test_reject_submission_sends_feedback_email_when_configured(self) -> None:
        """驳回带反馈邮箱的投稿 → 调用邮件发送器并传入审阅意见。"""
        sent: list[dict[str, str]] = []

        def fake_mailer(**kwargs):
            sent.append(kwargs)
            return {"status": "sent"}

        self.app.config["MAIL_SENDER"] = fake_mailer
        self.client.post(
            "/api/public/submissions",
            json={
                "title": "需修改投稿",
                "targetUrl": "https://example.com/rework",
                "feedbackEmail": "submitter@example.com",
            },
        )
        self.login()
        submissions = self.client.get("/api/admin/submissions").get_json()["submissions"]
        sid = submissions[0]["id"]

        resp = self.client.delete(
            f"/api/admin/submissions/{sid}",
            json={"reviewNote": "请补充作者信息。"},
        )

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["notification"], {"status": "sent"})
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]["recipient"], "submitter@example.com")
        self.assertEqual(sent[0]["title"], "需修改投稿")
        self.assertEqual(sent[0]["review_note"], "请补充作者信息。")

    def test_reject_submission_skips_email_when_smtp_not_configured(self) -> None:
        """未配置 SMTP 时，驳回仍成功，邮件状态为跳过。"""
        self.client.post(
            "/api/public/submissions",
            json={
                "title": "有邮箱但未配置 SMTP",
                "targetUrl": "https://example.com/no-smtp",
                "feedbackEmail": "submitter@example.com",
            },
        )
        self.login()
        sid = self.client.get("/api/admin/submissions").get_json()["submissions"][0]["id"]

        resp = self.client.delete(
            f"/api/admin/submissions/{sid}",
            json={"reviewNote": "暂不收录。"},
        )

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.get_json()["notification"],
            {"status": "skipped", "reason": "not_configured"},
        )

    def test_reject_submission_reports_mail_failure_without_rollback(self) -> None:
        """邮件失败不回滚驳回，响应返回 failed 状态。"""
        def failing_mailer(**_kwargs):
            raise RuntimeError("SMTP auth failed")

        self.app.config["MAIL_SENDER"] = failing_mailer
        self.client.post(
            "/api/public/submissions",
            json={
                "title": "发信失败投稿",
                "targetUrl": "https://example.com/mail-fail",
                "feedbackEmail": "submitter@example.com",
            },
        )
        self.login()
        sid = self.client.get("/api/admin/submissions").get_json()["submissions"][0]["id"]

        resp = self.client.delete(
            f"/api/admin/submissions/{sid}",
            json={"reviewNote": "无法通过。"},
        )

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["notification"]["status"], "failed")
        self.assertEqual(resp.get_json()["notification"]["reason"], "send_failed")
        remaining = self.client.get("/api/admin/submissions").get_json()["submissions"]
        self.assertEqual(remaining, [])

    def test_mailer_loads_smtp_config_from_app_config(self) -> None:
        """SMTP 配置可从运行配置读取。"""
        smtp_config = load_smtp_config(
            {
                "SMTP_HOST": "smtp.example.com",
                "SMTP_PORT": "587",
                "SMTP_USERNAME": "sender@example.com",
                "SMTP_PASSWORD": "app-password",
                "SMTP_FROM": "",
                "SMTP_FROM_NAME": "宏伟宝库测试",
                "SMTP_SECURITY": "starttls",
            },
            self.secrets_dir,
        )

        self.assertIsNotNone(smtp_config)
        self.assertEqual(smtp_config.host, "smtp.example.com")
        self.assertEqual(smtp_config.port, 587)
        self.assertEqual(smtp_config.from_email, "sender@example.com")
        self.assertEqual(smtp_config.from_name, "宏伟宝库测试")

    def test_mailer_loads_smtp_config_from_json_secret(self) -> None:
        """SMTP 配置可从单个 smtp.json 读取。"""
        self.secrets_dir.mkdir(parents=True, exist_ok=True)
        (self.secrets_dir / "smtp.json").write_text(
            json.dumps(
                {
                    "host": "smtp.163.com",
                    "port": 25,
                    "username": "sender@163.com",
                    "password": "auth-code",
                    "from": "sender@163.com",
                    "fromName": "宏伟宝库",
                    "security": "none",
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        smtp_config = load_smtp_config({}, self.secrets_dir)

        self.assertIsNotNone(smtp_config)
        self.assertEqual(smtp_config.host, "smtp.163.com")
        self.assertEqual(smtp_config.port, 25)
        self.assertEqual(smtp_config.username, "sender@163.com")
        self.assertEqual(smtp_config.security, "none")

    def test_mailer_sends_rejection_notice_with_safe_content(self) -> None:
        """SMTP 配置完整时构造驳回邮件并调用发送函数。"""
        app_config = {
            "SMTP_HOST": "smtp.example.com",
            "SMTP_PORT": "587",
            "SMTP_USERNAME": "sender@example.com",
            "SMTP_PASSWORD": "app-password",
            "SMTP_FROM": "",
            "SMTP_FROM_NAME": "宏伟宝库测试",
            "SMTP_SECURITY": "starttls",
        }
        with patch("server.mailer.send_email") as mocked_send:
            result = send_rejection_notice(
                app_config=app_config,
                secret_dir=self.secrets_dir,
                recipient="submitter@example.com",
                title="待修改资源",
                review_note="请补充可访问链接。",
            )

        self.assertEqual(result, {"status": "sent"})
        mocked_send.assert_called_once()
        message = mocked_send.call_args.args[1]
        self.assertIn("待修改资源", message["Subject"])
        self.assertIn("请补充可访问链接。", message.get_content())

    def test_approved_entry_visible_publicly(self) -> None:
        """通过后的条目在 /api/public/bootstrap 中可见。"""
        self.login()
        self.client.post(
            "/api/public/submissions",
            json={
                "title": "公开可见条目",
                "targetUrl": "https://example.com/public-visible",
                "feedbackEmail": "visible@example.com",
            },
        )
        submissions = self.client.get("/api/admin/submissions").get_json()["submissions"]
        sid = submissions[0]["id"]

        self.client.post(f"/api/admin/submissions/{sid}/approve")

        # 公共接口应可见
        bootstrap = self.client.get("/api/public/bootstrap")
        entries = bootstrap.get_json()["entries"]
        titles = [e["title"] for e in entries]
        self.assertIn("公开可见条目", titles)

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
                "coverPath": "/the-great-vault/covers/like_test.svg",
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
