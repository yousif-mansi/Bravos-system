-- Historical confirmations have no known fulfillment location. New confirmations
-- must provide a branch through the application command.
ALTER TABLE online_order_confirmation
  ADD COLUMN fulfillment_branch_id UUID REFERENCES branch (id) ON DELETE RESTRICT;

ALTER TABLE online_order_failed_return_inspection
  ADD COLUMN receiving_branch_id UUID REFERENCES branch (id) ON DELETE RESTRICT;

ALTER TABLE online_order
  ADD COLUMN pre_shipment_stock_disposition TEXT
  CHECK (pre_shipment_stock_disposition IN ('awaiting_inspection', 'released'));

-- Earlier confirmed cancellations released their stock in the same operation.
UPDATE online_order SET pre_shipment_stock_disposition='released'
WHERE status='cancelled_before_shipment' AND confirmed_at IS NOT NULL;

CREATE INDEX online_order_confirmation_branch_confirmed
  ON online_order_confirmation (fulfillment_branch_id, confirmed_at DESC, order_id);

-- A pre-shipment cancellation or the first failed-delivery event reverses
-- confirmed revenue. Failed-parcel inspection and closure are later stock
-- and lifecycle facts, and must not reverse revenue a second time.
CREATE INDEX online_order_fulfillment_reversals
  ON online_order_fulfillment_event (occurred_at DESC, order_id)
  WHERE event_type IN ('cancelled_before_shipment', 'delivery_failed');
