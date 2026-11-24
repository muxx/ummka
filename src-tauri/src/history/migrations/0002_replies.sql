CREATE INDEX history_post_replies ON history_post(root_id) WHERE root_id IS NOT NULL;
