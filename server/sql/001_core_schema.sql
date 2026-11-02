-- Core schema for Campus Map API. MySQL 8.0+. Execute once against DB_NAME.
-- user_id is an external identity from the host application.
CREATE TABLE IF NOT EXISTS campus (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, slug VARCHAR(80) NOT NULL, name VARCHAR(160) NOT NULL,
 description TEXT NULL, address VARCHAR(255) NULL, cover_asset_id BIGINT UNSIGNED NULL,
 status ENUM('draft','active','archived') NOT NULL DEFAULT 'draft', created_by BIGINT UNSIGNED NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY(id), UNIQUE KEY uk_campus_slug(slug), KEY idx_campus_status(status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS campus_member (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, campus_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL,
 role ENUM('owner','admin','editor','viewer') NOT NULL DEFAULT 'viewer', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(id), UNIQUE KEY uk_campus_member(campus_id,user_id), KEY idx_member_user(user_id),
 CONSTRAINT fk_campus_member_campus FOREIGN KEY(campus_id) REFERENCES campus(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS campus_map (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, campus_id BIGINT UNSIGNED NOT NULL, slug VARCHAR(80) NOT NULL, name VARCHAR(160) NOT NULL,
 description TEXT NULL, coordinate_system VARCHAR(40) NOT NULL DEFAULT 'campus-local',
 coordinate_unit ENUM('pixel','meter','local-unit') NOT NULL DEFAULT 'pixel',
 canvas_width DECIMAL(12,3) NOT NULL DEFAULT 640, canvas_height DECIMAL(12,3) NOT NULL DEFAULT 480,
 coordinate_config JSON NULL, status ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
 revision BIGINT UNSIGNED NOT NULL DEFAULT 1, published_version_id BIGINT UNSIGNED NULL,
 created_by BIGINT UNSIGNED NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY(id), UNIQUE KEY uk_campus_map_slug(campus_id,slug), KEY idx_map_campus_status(campus_id,status),
 CONSTRAINT fk_campus_map_campus FOREIGN KEY(campus_id) REFERENCES campus(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS campus_layer (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, campus_id BIGINT UNSIGNED NOT NULL, map_id BIGINT UNSIGNED NOT NULL,
 layer_key VARCHAR(80) NOT NULL, name VARCHAR(120) NOT NULL,
 feature_type ENUM('building','road','water','green','sports','boundary','poi','custom') NOT NULL,
 sort_order INT NOT NULL DEFAULT 0, visible TINYINT(1) NOT NULL DEFAULT 1, locked TINYINT(1) NOT NULL DEFAULT 0,
 style JSON NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY(id), UNIQUE KEY uk_map_layer_key(map_id,layer_key), KEY idx_layer_campus_map(campus_id,map_id,sort_order),
 CONSTRAINT fk_layer_campus FOREIGN KEY(campus_id) REFERENCES campus(id) ON DELETE CASCADE,
 CONSTRAINT fk_layer_map FOREIGN KEY(map_id) REFERENCES campus_map(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS campus_feature (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, campus_id BIGINT UNSIGNED NOT NULL, map_id BIGINT UNSIGNED NOT NULL,
 layer_id BIGINT UNSIGNED NOT NULL, feature_key VARCHAR(100) NOT NULL, name VARCHAR(160) NULL,
 geometry JSON NOT NULL, properties JSON NULL, revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
 created_by BIGINT UNSIGNED NOT NULL, updated_by BIGINT UNSIGNED NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY(id), UNIQUE KEY uk_map_feature_key(map_id,feature_key), KEY idx_feature_campus_map_layer(campus_id,map_id,layer_id),
 CONSTRAINT fk_feature_campus FOREIGN KEY(campus_id) REFERENCES campus(id) ON DELETE CASCADE,
 CONSTRAINT fk_feature_map FOREIGN KEY(map_id) REFERENCES campus_map(id) ON DELETE CASCADE,
 CONSTRAINT fk_feature_layer FOREIGN KEY(layer_id) REFERENCES campus_layer(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
