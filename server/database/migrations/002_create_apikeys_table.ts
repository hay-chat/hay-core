export const up = `
  CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    last_used_at TIMESTAMP,
    expires_at TIMESTAMP,
    scopes JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
  );
  
  CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
  CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
  CREATE INDEX idx_api_keys_is_active ON api_keys(is_active);
`;

export const down = `
  DROP TABLE IF EXISTS api_keys CASCADE;
`;