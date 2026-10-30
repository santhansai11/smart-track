"""Save a database connection locally using a hidden password prompt."""

import argparse
import getpass
from pathlib import Path
from urllib.parse import quote, urlsplit
from dotenv import dotenv_values, set_key


def connection_url(template: str, password: str) -> str:
    if template.count('[YOUR-PASSWORD]') != 1:
        raise ValueError('Use the connection template containing [YOUR-PASSWORD].')
    if not password:
        raise ValueError('Database password must not be empty.')
    url = template.replace('[YOUR-PASSWORD]', quote(password, safe=''))
    if url.startswith('postgresql://'):
        url = url.replace('postgresql://', 'postgresql+psycopg://', 1)
    parsed = urlsplit(url)
    if parsed.scheme != 'postgresql+psycopg' or not parsed.hostname:
        raise ValueError('A PostgreSQL connection template is required.')
    if 'sslmode=' not in parsed.query:
        url += ('&' if parsed.query else '?') + 'sslmode=require'
    return url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--template', help='Supabase Connect URI with [YOUR-PASSWORD] still present. Never pass a real password as an argument.')
    args = parser.parse_args()
    env_path = Path(__file__).resolve().parents[1] / '.env'
    config = dotenv_values(env_path)
    project_url = config.get('SUPABASE_URL', '')
    host = urlsplit(project_url).hostname
    if not host or not host.endswith('.supabase.co'):
        raise SystemExit('Configure SUPABASE_URL in backend/.env first.')
    template = args.template or f'postgresql://postgres:[YOUR-PASSWORD]@db.{host}:5432/postgres'
    try:
        password = getpass.getpass('Supabase database password (hidden): ')
        url = connection_url(template, password)
    except ValueError as error:
        raise SystemExit(str(error))
    set_key(env_path, 'DATABASE_URL', url)
    print('DATABASE_URL saved in backend/.env. Password not displayed. Connection and migrations have not yet been run.')


if __name__ == '__main__':
    main()
