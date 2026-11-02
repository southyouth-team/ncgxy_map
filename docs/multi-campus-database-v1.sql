-- Multi-campus map platform schema V1
-- MySQL 8.0+
-- Authentication users are managed by the host application; user_id is an external reference.
-- All geometry coordinates are campus-local 2D coordinates, not longitude/latitude by default.

CREATE TABLE campus (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(80) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT NULL,
  address VARCHAR(255) NULL,
  cover_asset_id BIGINT UNSIGNED NULL,
  status ENUM('draft', 'active', 'archived') NOT NULL DEFAULT 'draft',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_campus_slug (slug),
  KEY idx_campus_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE campus_member (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campus_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('owner', 'admin', 'editor', 'viewer') NOT NULL DEFAULT 'viewer',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_campus_member (campus_id, user_id),
  KEY idx_member_user (user_id),
  CONSTRAINT fk_campus_member_campus FOREIGN KEY (campus_id) REFERENCES campus(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE campus_map (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campus_id BIGINT UNSIGNED NOT NULL,
  slug VARCHAR(80) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT NULL,
  coordinate_system VARCHAR(40) NOT NULL DEFAULT 'campus-local',
  coordinate_unit ENUM('pixel', 'meter', 'local-unit') NOT NULL DEFAULT 'pixel',
  canvas_width DECIMAL(12,3) NOT NULL DEFAULT 640,
  canvas_height DECIMAL(12,3) NOT NULL DEFAULT 480,
  coordinate_config JSON NULL,
  status ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'draft',
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  published_version_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_campus_map_slug (campus_id, slug),
  KEY idx_map_campus_status (campus_id, status),
  CONSTRAINT fk_campus_map_campus FOREIGN KEY (campus_id) REFERENCES campus(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE campus_layer (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campus_id BIGINT UNSIGNED NOT NULL,
  map_id BIGINT UNSIGNED NOT NULL,
  layer_key VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  feature_type ENUM('building', 'road', 'water', 'green', 'sports', 'boundary', 'poi', 'custom') NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  visible TINYINT(1) NOT NULL DEFAULT 1,
  locked TINYINT(1) NOT NULL DEFAULT 0,
  style JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_map_layer_key (map_id, layer_key),
  KEY idx_layer_campus_map (campus_id, map_id, sort_order),
  CONSTRAINT fk_layer_campus FOREIGN KEY (campus_id) REFERENCES campus(id) ON DELETE CASCADE,
  CONSTRAINT fk_layer_map FOREIGN KEY (map_id) REFERENCES campus_map(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE campus_feature (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campus_id BIGINT UNSIGNED NOT NULL,
  map_id BIGINT UNSIGNED NOT NULL,
  layer_id BIGINT UNSIGNED NOT NULL,
  feature_key VARCHAR(100) NOT NULL,
  name VARCHAR(160) NULL,
  geometry JSON NOT NULL,
  properties JSON NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_map_feature_key (map_id, feature_key),
  KEY idx_feature_campus_map_layer (campus_id, map_id, layer_id),
  CONSTRAINT fk_feature_campus FOREIGN KEY (campus_id) REFERENCES campus(id) ON DELETE CASCADE,
  CONSTRAINT fk_feature_map FOREIGN KEY (map_id) REFERENCES campus_map(id) ON DELETE CASCADE,
  CONSTRAINT fk_feature_layer FOREIGN KEY (layer_id) REFERENCES campus_layer(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE campus_asset (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campus_id BIGINT UNSIGNED NOT NULL,
  map_id BIGINT UNSIGNED NULL,
  asset_type ENUM('base-map', 'image', 'texture', 'model', 'document', 'project-archive', 'other') NOT NULL,
  storage_provider VARCHAR(40) NOT NULL,
  bucket_name VARCHAR(120) NULL,
  object_key VARCHAR(512) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL,
  checksum_sha256 CHAR(64) NULL,
  metadata JSON NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_asset_object (storage_provider, bucket_name, object_key(191)),
  KEY idx_asset_campus_map (campus_id, map_id, asset_type),
  CONSTRAINT fk_asset_campus FOREIGN KEY (campus_id) REFERENCES campus(id) ON DELETE CASCADE,
  CONSTRAINT fk_asset_map FOREIGN KEY (map_id) REFERENCES campus_map(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE campus_version (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campus_id BIGINT UNSIGNED NOT NULL,
  map_id BIGINT UNSIGNED NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  version_name VARCHAR(160) NULL,
  status ENUM('draft', 'published', 'superseded') NOT NULL DEFAULT 'draft',
  snapshot JSON NOT NULL,
  change_summary VARCHAR(500) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  published_by BIGINT UNSIGNED NULL,
  published_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_map_version (map_id, version_number),
  KEY idx_version_campus_map (campus_id, map_id, created_at),
  CONSTRAINT fk_version_campus FOREIGN KEY (campus_id) REFERENCES campus(id) ON DELETE CASCADE,
  CONSTRAINT fk_version_map FOREIGN KEY (map_id) REFERENCES campus_map(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Add the circular published-version FK after both tables exist.
ALTER TABLE campus_map
  ADD CONSTRAINT fk_map_published_version
  FOREIGN KEY (published_version_id) REFERENCES campus_version(id) ON DELETE SET NULL;
