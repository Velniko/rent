-- Copyright (c) 2026 jiongjiong123441. All rights reserved.
-- Licensed under PolyForm Noncommercial 1.0.0.
-- Keep this notice and the LICENSE file with all copies and modified versions.

CREATE TABLE stored_objects (
  id TEXT PRIMARY KEY NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  owner_id TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('PUBLIC','OWNER','ADMIN')),
  storage_tier TEXT NOT NULL CHECK (storage_tier IN ('STANDARD','ARCHIVE')),
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  encrypted INTEGER NOT NULL DEFAULT 0,
  oci_ready INTEGER NOT NULL DEFAULT 0,
  r2_ready INTEGER NOT NULL DEFAULT 0,
  source_url TEXT UNIQUE,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_stored_objects_replication ON stored_objects(oci_ready,r2_ready,created_at);
CREATE TABLE identity_documents (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL,
  object_id TEXT NOT NULL UNIQUE REFERENCES stored_objects(id),
  document_type TEXT NOT NULL CHECK (document_type IN ('VISA','ID_CARD')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VERIFIED','REJECTED','EXPIRED')),
  rejection_reason TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  certified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_identity_documents_customer ON identity_documents(customer_id,created_at DESC);
CREATE TABLE storage_archive_records (
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  object_id TEXT NOT NULL REFERENCES stored_objects(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(source_table,source_id,content_hash)
);

CREATE TRIGGER identity_documents_certified_lock BEFORE INSERT ON identity_documents
WHEN EXISTS (SELECT 1 FROM identity_documents WHERE customer_id = NEW.customer_id AND certified_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'IDENTITY_ALREADY_CERTIFIED'); END;
CREATE TRIGGER identity_documents_immutable_evidence BEFORE UPDATE OF object_id,customer_id,document_type,certified_at ON identity_documents
WHEN OLD.certified_at IS NOT NULL AND (NEW.object_id <> OLD.object_id OR NEW.customer_id <> OLD.customer_id OR NEW.document_type <> OLD.document_type OR NEW.certified_at IS NOT OLD.certified_at)
BEGIN SELECT RAISE(ABORT, 'IDENTITY_EVIDENCE_IMMUTABLE'); END;
CREATE TABLE storage_migration_cursors (
  source TEXT PRIMARY KEY NOT NULL,
  last_rowid INTEGER NOT NULL DEFAULT 0
);

CREATE TRIGGER sensitive_access_no_update BEFORE UPDATE ON sensitive_data_access_logs
BEGIN SELECT RAISE(ABORT, 'SENSITIVE_ACCESS_LOG_IMMUTABLE'); END;
CREATE TRIGGER sensitive_access_no_delete BEFORE DELETE ON sensitive_data_access_logs
BEGIN SELECT RAISE(ABORT, 'SENSITIVE_ACCESS_LOG_IMMUTABLE'); END;
CREATE TRIGGER identity_audit_no_update BEFORE UPDATE ON audit_logs
WHEN OLD.action LIKE 'IDENTITY_%'
BEGIN SELECT RAISE(ABORT, 'IDENTITY_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER identity_audit_no_delete BEFORE DELETE ON audit_logs
WHEN OLD.action LIKE 'IDENTITY_%'
BEGIN SELECT RAISE(ABORT, 'IDENTITY_AUDIT_IMMUTABLE'); END;
