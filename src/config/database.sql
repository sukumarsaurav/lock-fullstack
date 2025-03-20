DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS reservation_history CASCADE;
DROP TABLE IF EXISTS verification_codes CASCADE;
DROP TABLE IF EXISTS social_logins CASCADE;
DROP TABLE IF EXISTS user_preferences CASCADE;
DROP TABLE IF EXISTS payment_methods CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS reservations CASCADE;
DROP TABLE IF EXISTS lockers CASCADE;
DROP TABLE IF EXISTS pricing_history CASCADE;
DROP TABLE IF EXISTS locker_sizes CASCADE;
DROP TABLE IF EXISTS locations CASCADE;
DROP TABLE IF EXISTS authentication_methods CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Enable PostGIS extension if available
DO $$ 
BEGIN
    CREATE EXTENSION IF NOT EXISTS postgis;
EXCEPTION
    WHEN OTHERS THEN
        NULL;
END $$;

-- ENUM types for status fields
DO $$ 
BEGIN
    CREATE TYPE reservation_status AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');
    CREATE TYPE locker_status AS ENUM ('AVAILABLE', 'OCCUPIED', 'MAINTENANCE');
    CREATE TYPE payment_status AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
    CREATE TYPE payment_method AS ENUM ('UPI', 'CARD', 'NETBANKING');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- USERS
CREATE TABLE users (
    user_id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(15) UNIQUE NOT NULL,
    full_name VARCHAR(255),
    date_of_birth DATE,
    profile_image_url TEXT,
    password_hash TEXT,
    password_reset_token TEXT,
    password_reset_expiry TIMESTAMP,
    is_verified BOOLEAN DEFAULT FALSE,
    is_2fa_enabled BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- AUTHENTICATION METHODS (BIOMETRIC/PIN/OTP)
CREATE TABLE authentication_methods (
    auth_id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    method_type VARCHAR(20) CHECK (method_type IN ('OTP', 'BIOMETRIC', 'PHONE_LOCK')),
    details JSONB, -- PIN hash/biometric metadata
    last_used TIMESTAMP,
    is_enabled BOOLEAN DEFAULT TRUE
);

-- LOCATIONS (LOCKER STATIONS) - Now using PostGIS
CREATE TABLE locations (
    location_id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    geo GEOGRAPHY(POINT, 4326), -- PostGIS spatial data type
    address TEXT,
    operating_hours JSONB, -- {"mon": ["09:00", "21:00"], ...}
    is_active BOOLEAN DEFAULT TRUE,
    popularity_score INT DEFAULT 0
);

-- Create a spatial index if PostGIS is available
CREATE INDEX IF NOT EXISTS idx_locations_geo ON locations USING GIST(geo);

-- LOCKER SIZES (SMALL/MEDIUM/LARGE)
CREATE TABLE locker_sizes (
    size_id UUID PRIMARY KEY,
    name VARCHAR(10) CHECK (name IN ('SMALL', 'MEDIUM', 'LARGE')),
    base_price DECIMAL(10,2) NOT NULL,
    description TEXT
);

-- PRICING HISTORY (TIME-BASED PRICING)
CREATE TABLE pricing_history (
    price_id UUID PRIMARY KEY,
    size_id UUID REFERENCES locker_sizes(size_id),
    price DECIMAL(10,2) NOT NULL,
    effective_from TIMESTAMP NOT NULL,
    effective_to TIMESTAMP
);

-- LOCKERS (PHYSICAL UNITS)
CREATE TABLE lockers (
    locker_id UUID PRIMARY KEY,
    location_id UUID REFERENCES locations(location_id),
    size_id UUID REFERENCES locker_sizes(size_id),
    locker_code VARCHAR(10) UNIQUE NOT NULL, -- Physical identifier (e.g., #A12)
    status locker_status NOT NULL DEFAULT 'AVAILABLE',
    last_maintenance DATE,
    metadata JSONB -- IoT sensor data
);

-- JSONB Index for Lockers Metadata (Optimized Search)
CREATE INDEX IF NOT EXISTS idx_lockers_metadata ON lockers USING GIN(metadata);

-- RESERVATIONS
CREATE TABLE reservations (
    reservation_id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(user_id),
    locker_id UUID REFERENCES lockers(locker_id),
    start_time TIMESTAMP NOT NULL,
    expected_end_time TIMESTAMP,
    actual_end_time TIMESTAMP,
    status reservation_status NOT NULL DEFAULT 'ACTIVE',
    total_cost DECIMAL(10,2),
    access_code VARCHAR(6), -- OTP for locker access
    extension_count INT DEFAULT 0, -- Track time extensions
    extended_end_time TIMESTAMP,
    extension_cost DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT NOW()
);

-- PAYMENTS
CREATE TABLE payments (
    payment_id UUID PRIMARY KEY,
    reservation_id UUID REFERENCES reservations(reservation_id),
    amount DECIMAL(10,2) NOT NULL,
    status payment_status NOT NULL DEFAULT 'PENDING',
    gateway_id VARCHAR(255), -- Razorpay/Stripe ID
    method payment_method NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- PAYMENT METHODS (SAVED CARDS/UPI)
CREATE TABLE payment_methods (
    method_id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(user_id),
    type payment_method NOT NULL,
    details JSONB NOT NULL, -- {"last4": "4242", "upi_id": "john@ybl"}
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- USER PREFERENCES (NOTIFICATIONS)
CREATE TABLE user_preferences (
    preference_id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(user_id),
    receive_email_notifications BOOLEAN DEFAULT TRUE,
    receive_sms_notifications BOOLEAN DEFAULT TRUE,
    marketing_opt_in BOOLEAN DEFAULT FALSE
);

-- SOCIAL LOGINS (GOOGLE/FACEBOOK/APPLE)
CREATE TABLE social_logins (
    social_id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(user_id),
    provider VARCHAR(20) CHECK (provider IN ('GOOGLE', 'FACEBOOK', 'APPLE')),
    provider_user_id TEXT NOT NULL, -- Unique ID from provider
    access_token TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- OTP VERIFICATION (SIGNUP/LOGIN) with Auto-Deletion of Expired OTPs
CREATE TABLE verification_codes (
    code_id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(user_id), -- Nullable for pre-signup OTPs
    phone VARCHAR(15) NOT NULL,
    code VARCHAR(6) NOT NULL,
    purpose VARCHAR(20) CHECK (purpose IN ('SIGNUP', 'LOGIN', 'PHONE_UPDATE')),
    expires_at TIMESTAMP NOT NULL,
    is_used BOOLEAN DEFAULT FALSE
);

-- Auto-delete expired OTPs every 1 hour
CREATE INDEX IF NOT EXISTS idx_verification_expiry ON verification_codes(expires_at);
CREATE OR REPLACE FUNCTION delete_expired_otps() RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM verification_codes WHERE expires_at < NOW();
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_delete_expired_otps
AFTER INSERT ON verification_codes
EXECUTE FUNCTION delete_expired_otps();

-- RESERVATION HISTORY (ANALYTICS)
CREATE TABLE reservation_history (
    history_id UUID PRIMARY KEY,
    reservation_id UUID REFERENCES reservations(reservation_id),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    total_hours INT,
    total_cost DECIMAL(10,2)
);

-- AUDIT LOGS (SECURITY) with Partitioning
CREATE TABLE audit_logs (
    log_id UUID,
    user_id UUID REFERENCES users(user_id),
    action_type VARCHAR(50) NOT NULL, -- e.g., 'LOCKER_OPEN', 'PAYMENT_FAILED'
    description TEXT,
    ip_address INET,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY(log_id, created_at)
) PARTITION BY RANGE (created_at);

-- Partitioning for Audit Logs (1 per month)
CREATE TABLE audit_logs_2025_03 PARTITION OF audit_logs
    FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');

-- INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_lockers_location ON lockers(location_id);
CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_reservation ON payments(reservation_id);
CREATE INDEX IF NOT EXISTS idx_social_provider ON social_logins(provider, provider_user_id);
CREATE INDEX IF NOT EXISTS idx_locations_popularity ON locations(popularity_score); 