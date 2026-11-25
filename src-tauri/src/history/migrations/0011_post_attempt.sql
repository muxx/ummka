CREATE TABLE post_attempt (
    pending_id TEXT PRIMARY KEY REFERENCES pending_post(pending_id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 4294967295),
    prior_uncertain INTEGER NOT NULL DEFAULT 0 CHECK (prior_uncertain IN (0, 1)),
    refusal_status INTEGER,
    refusal_code TEXT,
    refusal_message TEXT,
    CHECK (
        (refusal_status IS NULL AND refusal_code IS NULL AND refusal_message IS NULL)
        OR (prior_uncertain = 0 AND refusal_status IS NOT NULL AND refusal_status BETWEEN 400 AND 499
            AND refusal_status <> 401 AND refusal_code IS NOT NULL AND length(refusal_code) > 0)
    )
) STRICT, WITHOUT ROWID;
