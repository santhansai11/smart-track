
CREATE TABLE profiles (
	full_name VARCHAR(120) NOT NULL,
	role VARCHAR(10) DEFAULT 'STUDENT' NOT NULL,
	active BOOLEAN NOT NULL,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CHECK (role IN ('STUDENT','ROOT'))
)

;


CREATE TABLE audit_logs (
	actor_id UUID,
	action VARCHAR(80) NOT NULL,
	entity_id UUID,
	details JSON NOT NULL,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(actor_id) REFERENCES profiles (id)
)

;


CREATE TABLE routes (
	name VARCHAR(120) NOT NULL,
	description TEXT NOT NULL,
	active BOOLEAN NOT NULL,
	created_by UUID NOT NULL,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(created_by) REFERENCES profiles (id)
)

;


CREATE TABLE route_versions (
	route_id UUID NOT NULL,
	version INTEGER NOT NULL,
	coordinates JSON NOT NULL,
	length_m FLOAT NOT NULL,
	tolerance_m FLOAT NOT NULL,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (route_id, version),
	CHECK (length_m >= 100),
	CHECK (tolerance_m BETWEEN 5 AND 100),
	FOREIGN KEY(route_id) REFERENCES routes (id)
)

;


CREATE TABLE rooms (
	name VARCHAR(120) NOT NULL,
	description TEXT NOT NULL,
	route_version_id UUID NOT NULL,
	capacity INTEGER NOT NULL,
	invitation_hash VARCHAR(64) NOT NULL,
	visibility VARCHAR(10) NOT NULL,
	locked BOOLEAN NOT NULL,
	archived BOOLEAN NOT NULL,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CHECK (capacity BETWEEN 1 AND 1000),
	CHECK (visibility IN ('PUBLIC','PRIVATE')),
	FOREIGN KEY(route_version_id) REFERENCES route_versions (id),
	UNIQUE (invitation_hash)
)

;


CREATE TABLE competitions (
	room_id UUID NOT NULL,
	route_version_id UUID NOT NULL,
	status VARCHAR(12) NOT NULL,
	started_at TIMESTAMP WITH TIME ZONE,
	finalize_after TIMESTAMP WITH TIME ZONE,
	published_at TIMESTAMP WITH TIME ZONE,
	ranking_rules JSON NOT NULL,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CHECK (status IN ('LOCKED','RUNNING','FINALIZING','COMPLETED')),
	CHECK ((status = 'LOCKED' AND started_at IS NULL) OR (status <> 'LOCKED' AND started_at IS NOT NULL)),
	CHECK ((status = 'COMPLETED') = (published_at IS NOT NULL)),
	FOREIGN KEY(room_id) REFERENCES rooms (id),
	FOREIGN KEY(route_version_id) REFERENCES route_versions (id)
)

;


CREATE TABLE room_members (
	room_id UUID NOT NULL,
	user_id UUID NOT NULL,
	joined_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (room_id, user_id),
	FOREIGN KEY(room_id) REFERENCES rooms (id),
	FOREIGN KEY(user_id) REFERENCES profiles (id)
)

;


CREATE TABLE competition_participants (
	competition_id UUID NOT NULL,
	user_id UUID NOT NULL,
	status VARCHAR(20) NOT NULL,
	id UUID NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (competition_id, user_id),
	CHECK (status IN ('REGISTERED','RUNNING','FINISHED','WITHDRAWN','DISQUALIFIED','RECOVERY_PENDING')),
	FOREIGN KEY(competition_id) REFERENCES competitions (id),
	FOREIGN KEY(user_id) REFERENCES profiles (id)
)

;


CREATE TABLE competition_results (
	participant_id UUID NOT NULL,
	rank INTEGER,
	PRIMARY KEY (participant_id),
	CHECK (rank IS NULL OR rank > 0),
	FOREIGN KEY(participant_id) REFERENCES competition_participants (id)
)

;


CREATE TABLE participant_status_history (
	participant_id UUID NOT NULL,
	status VARCHAR(20) NOT NULL,
	reason TEXT NOT NULL,
	actor_id UUID NOT NULL,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(participant_id) REFERENCES competition_participants (id),
	FOREIGN KEY(actor_id) REFERENCES profiles (id)
)

;


CREATE TABLE recovery_requests (
	participant_id UUID NOT NULL,
	reason TEXT NOT NULL,
	previous_status VARCHAR(12) NOT NULL,
	status VARCHAR(10) NOT NULL,
	reviewed_by UUID,
	reviewed_at TIMESTAMP WITH TIME ZONE,
	decision_reason TEXT,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CHECK (status IN ('PENDING','APPROVED','REJECTED')),
	CHECK (previous_status IN ('FINISHED','WITHDRAWN')),
	CHECK ((status = 'PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR (status <> 'PENDING' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
	FOREIGN KEY(participant_id) REFERENCES competition_participants (id),
	FOREIGN KEY(reviewed_by) REFERENCES profiles (id)
)

;


CREATE TABLE running_sessions (
	participant_id UUID NOT NULL,
	last_seq INTEGER NOT NULL,
	distance_m FLOAT NOT NULL,
	partial_m FLOAT NOT NULL,
	lap_count INTEGER NOT NULL,
	progress JSON NOT NULL,
	location_consent BOOLEAN NOT NULL,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CHECK (last_seq >= 0 AND distance_m >= 0 AND partial_m >= 0 AND lap_count >= 0),
	UNIQUE (participant_id),
	FOREIGN KEY(participant_id) REFERENCES competition_participants (id)
)

;


CREATE TABLE gps_track_points (
	session_id UUID NOT NULL,
	seq INTEGER NOT NULL,
	captured_at TIMESTAMP WITH TIME ZONE NOT NULL,
	latitude FLOAT NOT NULL,
	longitude FLOAT NOT NULL,
	accuracy_m FLOAT NOT NULL,
	speed_mps FLOAT,
	heading FLOAT,
	validation VARCHAR(20) NOT NULL,
	payload_hash VARCHAR(64) NOT NULL,
	PRIMARY KEY (session_id, seq),
	CHECK (seq > 0),
	CHECK (latitude BETWEEN -90 AND 90),
	CHECK (longitude BETWEEN -180 AND 180),
	CHECK (accuracy_m >= 0),
	CHECK (speed_mps IS NULL OR speed_mps >= 0),
	CHECK (heading IS NULL OR (heading >= 0 AND heading < 360)),
	FOREIGN KEY(session_id) REFERENCES running_sessions (id)
)

;


CREATE TABLE lap_records (
	session_id UUID NOT NULL,
	number INTEGER NOT NULL,
	from_seq INTEGER NOT NULL,
	to_seq INTEGER NOT NULL,
	started_at TIMESTAMP WITH TIME ZONE NOT NULL,
	finished_at TIMESTAMP WITH TIME ZONE NOT NULL,
	active_ms BIGINT NOT NULL,
	id UUID NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (session_id, number),
	UNIQUE (session_id, to_seq),
	CHECK (number > 0 AND from_seq > 0 AND to_seq > from_seq AND active_ms > 0),
	CHECK (finished_at > started_at),
	FOREIGN KEY(session_id) REFERENCES running_sessions (id)
)

;


CREATE TABLE session_segments (
	session_id UUID NOT NULL,
	started_at TIMESTAMP WITH TIME ZONE NOT NULL,
	ended_at TIMESTAMP WITH TIME ZONE,
	id UUID NOT NULL,
	PRIMARY KEY (id),
	CHECK (ended_at IS NULL OR ended_at >= started_at),
	FOREIGN KEY(session_id) REFERENCES running_sessions (id)
)

;

CREATE UNIQUE INDEX one_root ON profiles (role) WHERE role = 'ROOT';

CREATE INDEX audit_chronology ON audit_logs (created_at, id);

CREATE INDEX ix_competitions_room_id ON competitions (room_id);

CREATE UNIQUE INDEX one_open_competition_per_room ON competitions (room_id) WHERE status <> 'COMPLETED';

CREATE INDEX member_user_rooms ON room_members (user_id, room_id);

CREATE INDEX ix_competition_participants_user_id ON competition_participants (user_id);

CREATE INDEX ix_participant_status_history_participant_id ON participant_status_history (participant_id);

CREATE UNIQUE INDEX one_pending_recovery ON recovery_requests (participant_id) WHERE status = 'PENDING';

CREATE INDEX ix_recovery_requests_participant_id ON recovery_requests (participant_id);

CREATE INDEX ix_session_segments_session_id ON session_segments (session_id);

CREATE UNIQUE INDEX one_active_segment ON session_segments (session_id) WHERE ended_at IS NULL;
