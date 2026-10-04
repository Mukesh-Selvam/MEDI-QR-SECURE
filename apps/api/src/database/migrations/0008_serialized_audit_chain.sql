CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint

ALTER TABLE audit_events
  ADD COLUMN event_index BIGINT;
--> statement-breakpoint

WITH ordered_events AS (
  SELECT id, row_number() OVER (ORDER BY timestamp, id) AS event_index
  FROM audit_events
)
UPDATE audit_events
SET event_index = ordered_events.event_index
FROM ordered_events
WHERE audit_events.id = ordered_events.id;
--> statement-breakpoint

ALTER TABLE audit_events
  ALTER COLUMN event_index SET NOT NULL,
  ALTER COLUMN event_index SET DEFAULT 0;

CREATE UNIQUE INDEX audit_events_event_index_idx ON audit_events (event_index);
--> statement-breakpoint

ALTER TABLE audit_events
  DROP CONSTRAINT IF EXISTS audit_events_actor_id_users_id_fk;
--> statement-breakpoint

CREATE TABLE audit_chain_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  last_event_index BIGINT NOT NULL,
  last_hash VARCHAR(64) NOT NULL
);
--> statement-breakpoint

CREATE FUNCTION audit_event_canonical_content(
  event_id UUID,
  event_index BIGINT,
  event_timestamp TIMESTAMPTZ,
  actor_id UUID,
  actor_role TEXT,
  action TEXT,
  resource_type TEXT,
  resource_id TEXT,
  outcome TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  previous_hash TEXT
) RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'id', event_id::TEXT,
    'eventIndex', event_index,
    'timestamp', to_char(
      event_timestamp AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'actorId', actor_id::TEXT,
    'actorRole', actor_role,
    'action', action,
    'resourceType', resource_type,
    'resourceId', resource_id,
    'outcome', outcome,
    'ipHash', ip_hash,
    'userAgent', user_agent,
    'previousHash', previous_hash
  )::TEXT
$$;
--> statement-breakpoint

DO $$
DECLARE
  event_row RECORD;
  chain_hash TEXT := 'GENESIS';
  next_hash TEXT;
  last_index BIGINT := 0;
BEGIN
  FOR event_row IN
    SELECT * FROM audit_events ORDER BY event_index
  LOOP
    last_index := event_row.event_index;
    next_hash := encode(
      digest(
        convert_to(
          audit_event_canonical_content(
            event_row.id,
            event_row.event_index,
            event_row.timestamp,
            event_row.actor_id,
            event_row.actor_role,
            event_row.action,
            event_row.resource_type,
            event_row.resource_id,
            event_row.outcome::TEXT,
            event_row.ip_hash,
            event_row.user_agent,
            chain_hash
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );

    UPDATE audit_events
    SET previous_hash = chain_hash, integrity_hash = next_hash
    WHERE id = event_row.id;
    chain_hash := next_hash;
  END LOOP;

  INSERT INTO audit_chain_state (singleton, last_event_index, last_hash)
  VALUES (TRUE, last_index, chain_hash);
END
$$;
--> statement-breakpoint

CREATE FUNCTION append_audit_event_to_chain() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  chain_state audit_chain_state%ROWTYPE;
BEGIN
  UPDATE audit_chain_state
  SET last_event_index = last_event_index + 1
  WHERE singleton = TRUE
  RETURNING * INTO chain_state;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit chain state is unavailable';
  END IF;

  NEW.event_index := chain_state.last_event_index;
  NEW.previous_hash := chain_state.last_hash;
  NEW.integrity_hash := encode(
    digest(
      convert_to(
        audit_event_canonical_content(
          NEW.id,
          NEW.event_index,
          NEW.timestamp,
          NEW.actor_id,
          NEW.actor_role,
          NEW.action,
          NEW.resource_type,
          NEW.resource_id,
          NEW.outcome::TEXT,
          NEW.ip_hash,
          NEW.user_agent,
          NEW.previous_hash
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  UPDATE audit_chain_state
  SET last_hash = NEW.integrity_hash
  WHERE singleton = TRUE;

  RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE TRIGGER audit_events_append_to_chain
  BEFORE INSERT ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION append_audit_event_to_chain();
--> statement-breakpoint

CREATE FUNCTION reject_audit_event_mutation() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are immutable'
    USING ERRCODE = '55000';
END
$$;
--> statement-breakpoint

CREATE TRIGGER audit_events_are_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION reject_audit_event_mutation();
--> statement-breakpoint

REVOKE UPDATE, DELETE ON TABLE audit_events FROM PUBLIC;
