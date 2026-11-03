-- Copyright (c) 2026 jiongjiong123441. All rights reserved.
-- Licensed under PolyForm Noncommercial 1.0.0.
-- Noncommercial use, modification, and distribution are permitted.
-- Keep this notice and the LICENSE file with all copies and modified versions.

-- Disable card surcharges without changing gift-card charges or historical payments.
UPDATE systemSettings
SET value = json_set(value, '$.processingFeeRate', 0), updatedAt = CURRENT_TIMESTAMP
WHERE key = 'paymentMethods' AND json_valid(value) = 1 AND json_type(value) = 'object';

-- Future installments with no payment object can safely lose their old fee now.
-- Linked Stripe objects are reconciled/cancelled by the payment service first.
UPDATE rental_installments
SET processing_fee = 0, amount = ROUND(rental_amount + deposit_amount, 2)
WHERE status IN ('pending', 'failed') AND processing_fee > 0
  AND stripe_payment_intent_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM payments p WHERE p.id = rental_installments.payment_id
      AND (p.status IN ('paid', 'refunded') OR p.stripe_payment_intent_id IS NOT NULL OR p.stripe_checkout_session_id IS NOT NULL)
  );
