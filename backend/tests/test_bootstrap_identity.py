from types import SimpleNamespace
import pytest
import httpx
from scripts import bootstrap_root


def test_bootstrap_requires_matching_verified_account(monkeypatch):
    cfg = SimpleNamespace(supabase_url='https://project.supabase.co', root_admin_email='owner@example.com')
    body = {'id': 'verified-account-id', 'email': 'owner@example.com', 'email_confirmed_at': '2026-10-30T00:00:00Z'}
    def user_request(url, *, headers, timeout):
        assert headers == {'apikey': 'public-test-key', 'Authorization': 'Bearer verified-test-token'}
        return httpx.Response(200, json=body, request=httpx.Request('GET', url))
    monkeypatch.setattr(bootstrap_root.httpx, 'get', user_request)
    assert bootstrap_root.verified_identity(cfg, 'verified-test-token', 'public-test-key')['id'] == 'verified-account-id'
    body['email'] = 'another@example.com'
    with pytest.raises(SystemExit):
        bootstrap_root.verified_identity(cfg, 'verified-test-token', 'public-test-key')
    body['email'] = cfg.root_admin_email
    body['email_confirmed_at'] = None
    with pytest.raises(SystemExit):
        bootstrap_root.verified_identity(cfg, 'verified-test-token', 'public-test-key')
