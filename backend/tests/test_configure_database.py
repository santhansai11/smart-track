import pytest
from scripts.configure_database import connection_url


def test_password_is_encoded_and_tls_enabled():
    from urllib.parse import unquote, urlsplit
    url = connection_url('postgresql://postgres:[YOUR-PASSWORD]@db.test.supabase.co:5432/postgres', 'test@:/?#%pass')
    parsed = urlsplit(url)
    assert parsed.scheme == 'postgresql+psycopg'
    assert parsed.hostname == 'db.test.supabase.co'
    assert unquote(parsed.password) == 'test@:/?#%pass'
    assert parsed.query == 'sslmode=require'


def test_helper_rejects_password_on_command_line():
    with pytest.raises(ValueError):
        connection_url('postgresql://postgres:realpassword@db.test.supabase.co/postgres', 'test')
