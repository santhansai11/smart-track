# Database design, storage, and retention

## Inspection and ownership

The workspace was empty when implementation began: there was no schema or existing Supabase connection to inspect. The migrations were applied and verified on local PostgreSQL 18.4 against a minimal test auth schema. No production schema was accessed.

| Table | Defined requirement / ownership |
|---|---|
| `profiles` | Display name, STUDENT/ROOT, active state; UUID references `auth.users`. Email/password/confirmation remain in Supabase Auth. |
| `routes` | Mutable name, description, availability and author. |
| `route_versions` | Immutable ordered coordinates, corridor and cached route length. First vertex is start/finish. |
| `rooms` | Joining policy (code required), visibility, capacity, assigned version; code stored only as SHA-256 hash. |
| `room_members` | Unique `(room_id, user_id)` memberships and joining time. |
| `competitions` | Room/route snapshot, ranking rules, official start, state, recovery grace and publication time. |
| `competition_participants` | Unique `(competition_id,user_id)` snapshot and current status. |
| `running_sessions` | One per participant; sequence frontier and server-only incremental validation/summary caches. |
| `session_segments` | Authoritative active intervals for pauses and recovery. One open interval per session. |
| `gps_track_points` | Raw observations, quality metadata, validation reason and idempotency hash. Composite PK `(session_id,seq)`. |
| `lap_records` | Validated lap number, active timing, original evidence sequence range. |
| `recovery_requests` | Reason, previous status, review decision, administrator and timestamp. One pending request per participant. |
| `participant_status_history` | Append-only lifecycle/withdrawal history with actor and reason. |
| `competition_results` | One immutable final rank per participant; statistics read from frozen session/lap records. |
| `audit_logs` | Append-only administrative/retention/publication record. |

There is no separate checkpoint table: ordered eighth-route checkpoints are derived from immutable route geometry. No second copy of email, room membership counts, recovery counts, fastest laps, elapsed time, or result statistics is stored. Session counters/projection state and route length are deliberately cached to keep ingestion incremental and summary queries independent of trail length. Ranking uses actual lap rows, validated partial progression, and authoritative segment durations.

## GPS pipeline

The initial configurable sampling period is 3 seconds (2–5 supported). `watchPosition` callback frequency is browser-controlled; the client throttles accepted samples, so this is a target interval, not a guarantee. Up to 200 points are read from IndexedDB per upload (API maximum 300), with synchronization every 15 seconds and before pause/finish. A three-hour run is not capped: 2,161 / 3,601 / 5,401 points at 5 / 3 / 2 seconds, including the initial observation.

Sequence allocation and writing the raw sample happen atomically in IndexedDB. The account UUID and session UUID isolate local records. Web Locks prevent competing capture tabs; sequence IDs remain the definitive server idempotency mechanism. Points are removed locally only after an acknowledgement **whose database transaction has committed**. Overlapping retries are accepted only when the canonical payload hash matches. Gaps, conflicting retries, missing timezones and nonfinite values are rejected. Bad-quality samples remain in PostgreSQL with validation reasons and do not earn progress.

Session row locks serialize a runner’s batches; separate runners ingest concurrently. GPS checks timestamps, corridor, accuracy, plausible speed, ordered checkpoints, direction, route coverage and start/finish wrap. Gaps over 30 seconds break continuous lap evidence. Explicit pause/recovery resumes preserve prior partial progress but require returning near the last valid position. Paused time is excluded from lap duration via segment intersections. Raw GPS alone cannot prove an uncompromised device location.

## Query and transaction patterns

- `(session_id,seq)` primary key supports bounded, ordered history and duplicate lookups; no redundant timestamp index.
- Participant and membership uniqueness doubles as lookup indexing; user-first indexes support personal rooms/history.
- Route `(route_id,version)` uniqueness supports latest-version queries.
- Partial indexes enforce one root, one unfinished competition per room, one open segment, and one pending recovery.
- `(session_id,from_seq,to_seq)` supports retention evidence exclusion; partial `competitions(finalize_after)` supports the finalizer’s actual query.
- Audit `(created_at,id)` supports stable chronology. GPS/laps use sequence cursors; room, participant, audit and history screens use bounded offset pagination. Deep offsets should be migrated to cursors when measured traffic warrants it.
- Room joins and capacity checks lock the room in one transaction. Locking freezes participants and room state together. Lifecycle operations lock competition, then session. Publication uses one competition lock and unique result keys, preventing double publication across backend instances.
- Leaderboards use joined summaries and bulk segment/recovery queries, not per-runner GPS scans. No GPS is added to the realtime publication; only competition/participant status events are allowed. UI polls summaries every five seconds as a fallback and for lap updates.
- SQLAlchemy pool defaults to 5 connections + 2 overflow per process; psycopg automatic prepared statements are disabled for transaction pooling. Avoid multiplying workers without a total connection budget. Migrations use direct/session mode.

No partitioning is applied yet. Consider time partitioning only after measuring retention operations and table/index growth at millions of points; uniqueness, evidence retention, and cross-partition keys need a deliberate migration.

## Measured storage and capacity

The local benchmark produced **240.9 bytes per GPS point including its index**, measured across 108,024 stored synthetic points (a previous 3-second run plus the final 2-second workload). This excludes other tables, WAL, database system catalogs, bloat, backups and Auth data. The hash uses 64 hex characters to detect changed retry payloads; binary hashes are a possible future space optimization.

| Sampling interval | Points in 3 hours | Estimated GPS relation per runner | 50 runners |
|---|---:|---:|---:|
| 2 seconds | 5,401 | 1.30 MB | 65.1 MB |
| 3 seconds | 3,601 | 0.87 MB | 43.4 MB |
| 5 seconds | 2,161 | 0.52 MB | 26.0 MB |

These are decimal MB estimates, not quotas or capacity guarantees. Reserve substantial space for all other data and maintenance; a 500 MB project cannot sustain unlimited historical three-hour runs. At a conservative 200 MB GPS budget, roughly 150 two-second sessions would consume that budget at this measured size. Retained lap evidence continues to grow even when other points expire.

As checked on 2026-10-30, Supabase Free advertises 500 MB database size, 50,000 monthly active users, 5 GB egress, 5 GB cached egress, 1 GB file storage, and pauses after a week of inactivity. MAU and API quotas do not imply simultaneous runner capacity. [Supabase pricing](https://supabase.com/pricing).

Nano compute documents 60 database connections and 200 pooler clients; these are different from Realtime websocket limits and from supported runner counts. Budget pools across all services and recheck before deployment. [Compute limits](https://supabase.com/docs/guides/platform/compute-and-disk). For transaction pooling, psycopg uses `prepare_threshold=None`. [Official pooling guidance](https://supabase.com/docs/guides/database/connecting-to-postgres), [prepared statements](https://supabase.com/docs/guides/troubleshooting/disabling-prepared-statements-qL8lEL).

## Retention, backups, and privacy

Default GPS retention is 90 days, configurable in backend environment. Maintenance is manual/scheduled externally, dry-run first:

```text
python -m scripts.retention
python -m scripts.retention --apply --verified-backup <private-backup-reference>
```

Each run considers at most 10,000 points from competitions completed before the cutoff. It excludes **every original sample between each completed lap’s start and finish sequence**. A database trigger independently blocks evidence deletion. Historical competitions, sessions, laps, withdrawals, recovery decisions, status events and results cannot be ordinarily deleted. An audited backup reference is required before apply. The reference is an operator assertion; the tool cannot independently attest that an external backup is restorable.

Take encrypted PostgreSQL custom-format backups (`pg_dump -Fc`) to private storage, apply an access/expiry policy, and regularly restore into an isolated database to verify them. Never place GPS exports/backups in public frontend assets. Supabase Free must not be assumed to include managed recoverable backups or point-in-time recovery. Check current plan features. Privacy erasure requests require a separately authorized, audited process and explicit treatment of evidence/backup retention; ordinary competition controls are not a deletion mechanism.

Students cannot query another runner’s detailed trail. Root trail access additionally requires per-session participant consent, enforced in the API. Direct browser GPS table access is revoked and RLS enabled. Do not add these tables to broad publications or permissive policies.
