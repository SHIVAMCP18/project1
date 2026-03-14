BEGIN;

-- Insert Partners
INSERT INTO partners (name, email) VALUES 
('Acme Supplier Corp','sales@acme.com'),
('Globex Construction','procurement@globex.com') 
ON CONFLICT DO NOTHING;

-- Receipts
INSERT INTO operations (reference, type, status, source_warehouse_id, dest_warehouse_id, partner_id, created_at)
SELECT 'WH/IN/' || trunc(random() * 1000)::text, 'receipt', 'done', NULL, 
  (SELECT id FROM warehouses WHERE name = 'Main Warehouse'),
  (SELECT id FROM partners WHERE name = 'Acme Supplier Corp'),
  NOW() - interval '2 days';

INSERT INTO operation_lines (operation_id, product_id, qty_demand, qty_done)
SELECT currval(pg_get_serial_sequence('operations', 'id')), 
  (SELECT id FROM products WHERE sku = 'SKU-001'), 100, 100;

-- Deliveries
INSERT INTO operations (reference, type, status, source_warehouse_id, dest_warehouse_id, partner_id, created_at)
SELECT 'WH/OUT/' || trunc(random() * 1000)::text, 'delivery', 'draft', 
  (SELECT id FROM warehouses WHERE name = 'Production Floor'),
  NULL,
  (SELECT id FROM partners WHERE name = 'Globex Construction'),
  NOW() - interval '1 days';

INSERT INTO operation_lines (operation_id, product_id, qty_demand, qty_done)
SELECT currval(pg_get_serial_sequence('operations', 'id')), 
  (SELECT id FROM products WHERE sku = 'SKU-004'), 15, 0;

-- Transfers
INSERT INTO operations (reference, type, status, source_warehouse_id, dest_warehouse_id, partner_id, created_at)
SELECT 'WH/INT/' || trunc(random() * 1000)::text, 'transfer', 'ready', 
  (SELECT id FROM warehouses WHERE name = 'Warehouse 2'),
  (SELECT id FROM warehouses WHERE name = 'Production Floor'),
  NULL,
  NOW();

INSERT INTO operation_lines (operation_id, product_id, qty_demand, qty_done)
SELECT currval(pg_get_serial_sequence('operations', 'id')), 
  (SELECT id FROM products WHERE sku = 'SKU-005'), 100, 0;

COMMIT;
