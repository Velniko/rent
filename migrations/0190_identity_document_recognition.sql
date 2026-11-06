-- Copyright (c) 2026 jiongjiong123441. All rights reserved.
-- Licensed under PolyForm Noncommercial 1.0.0.
-- Keep this notice and the LICENSE file with all copies and modified versions.

-- Keep the existing VISA/ID_CARD category and historical certifications intact.
ALTER TABLE identity_documents ADD COLUMN document_kind TEXT NOT NULL DEFAULT 'OTHER'
  CHECK(document_kind IN ('VISA','DRIVER_LICENCE','PASSPORT','OTHER'));
UPDATE identity_documents SET document_kind = 'VISA' WHERE document_type = 'VISA';
ALTER TABLE identity_documents ADD COLUMN recognition_status TEXT CHECK(recognition_status IS NULL OR recognition_status = 'MATCH');
ALTER TABLE identity_documents ADD COLUMN recognition_confidence REAL CHECK(recognition_confidence IS NULL OR recognition_confidence BETWEEN 0 AND 1);
ALTER TABLE identity_documents ADD COLUMN recognition_model TEXT;
CREATE TRIGGER identity_documents_recognition_immutable
BEFORE UPDATE OF document_kind,recognition_status,recognition_confidence,recognition_model ON identity_documents
WHEN OLD.certified_at IS NOT NULL AND (
  NEW.document_kind IS NOT OLD.document_kind OR NEW.recognition_status IS NOT OLD.recognition_status OR
  NEW.recognition_confidence IS NOT OLD.recognition_confidence OR NEW.recognition_model IS NOT OLD.recognition_model)
BEGIN SELECT RAISE(ABORT, 'IDENTITY_EVIDENCE_IMMUTABLE'); END;
