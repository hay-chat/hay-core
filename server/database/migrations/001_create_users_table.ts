export const up = `
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP
  );
  
  CREATE INDEX idx_users_email ON users(email);
  CREATE INDEX idx_users_is_active ON users(is_active);
`;

export const down = `
  DROP TABLE IF EXISTS users CASCADE;
`;