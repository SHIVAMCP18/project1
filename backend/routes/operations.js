const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Generate reference number
const genRef = (type) => {
  const prefixes = { receipt: 'REC', delivery: 'OUT', transfer: 'INT', adjustment: 'ADJ' };
  const year = new Date().getFullYear();
  const rand = String(Math.floor(Math.random() * 9000) + 1000);
  return `${prefixes[type]}/${year}/${rand}`;
};

// GET all operations (with filters)
router.get('/', async (req, res) => {
  try {
    const { type, status, search, limit = 50, offset = 0 } = req.query;
    let query = `
      SELECT o.*,
        sw.name as source_warehouse_name,
        dw.name as dest_warehouse_name,
        COUNT(ol.id) as line_count
      FROM operations o
      LEFT JOIN warehouses sw ON o.source_warehouse_id = sw.id
      LEFT JOIN warehouses dw ON o.dest_warehouse_id = dw.id
      LEFT JOIN operation_lines ol ON o.id = ol.operation_id
      WHERE 1=1
    `;
    const params = [];

    if (type) { params.push(type); query += ` AND o.type = $${params.length}`; }
    if (status) { params.push(status); query += ` AND o.status = $${params.length}`; }
    if (search) { params.push(`%${search}%`); query += ` AND o.reference ILIKE $${params.length}`; }

    query += ` GROUP BY o.id, sw.name, dw.name ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Count total
    let countQuery = `SELECT COUNT(*) FROM operations WHERE 1=1`;
    const countParams = [];
    if (type) { countParams.push(type); countQuery += ` AND type = $${countParams.length}`; }
    if (status) { countParams.push(status); countQuery += ` AND status = $${countParams.length}`; }
    const countResult = await pool.query(countQuery, countParams);

    res.json({ success: true, data: result.rows, total: parseInt(countResult.rows[0].count) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET single operation with lines
router.get('/:id', async (req, res) => {
  try {
    const op = await pool.query(`
      SELECT o.*,
        sw.name as source_warehouse_name,
        dw.name as dest_warehouse_name
      FROM operations o
      LEFT JOIN warehouses sw ON o.source_warehouse_id = sw.id
      LEFT JOIN warehouses dw ON o.dest_warehouse_id = dw.id
      WHERE o.id = $1
    `, [req.params.id]);

    if (!op.rows.length) return res.status(404).json({ success: false, error: 'Operation not found' });

    const lines = await pool.query(`
      SELECT ol.*, p.name as product_name, p.sku, p.unit, p.current_stock
      FROM operation_lines ol
      JOIN products p ON ol.product_id = p.id
      WHERE ol.operation_id = $1
    `, [req.params.id]);

    res.json({ success: true, data: { ...op.rows[0], lines: lines.rows } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST create operation
router.post('/', async (req, res) => {
  const { type, source_warehouse_id, dest_warehouse_id, partner, notes, scheduled_date, lines } = req.body;
  if (!type) return res.status(400).json({ success: false, error: 'Operation type is required' });
  if (!lines || !lines.length) return res.status(400).json({ success: false, error: 'At least one product line is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const reference = genRef(type);
    const opResult = await client.query(`
      INSERT INTO operations (reference, type, status, source_warehouse_id, dest_warehouse_id, partner, notes, scheduled_date)
      VALUES ($1,$2,'draft',$3,$4,$5,$6,$7) RETURNING *
    `, [reference, type, source_warehouse_id || null, dest_warehouse_id || null, partner || null, notes || null, scheduled_date || null]);

    const operation = opResult.rows[0];

    // Insert lines
    for (const line of lines) {
      if (!line.product_id || !line.qty_demand) continue;
      await client.query(`
        INSERT INTO operation_lines (operation_id, product_id, qty_demand)
        VALUES ($1,$2,$3)
      `, [operation.id, line.product_id, line.qty_demand]);
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: operation });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// PATCH update operation status / lines (draft → ready)
router.patch('/:id', async (req, res) => {
  const { status, partner, notes, lines } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (lines) {
      await client.query('DELETE FROM operation_lines WHERE operation_id = $1', [req.params.id]);
      for (const line of lines) {
        await client.query(`
          INSERT INTO operation_lines (operation_id, product_id, qty_demand)
          VALUES ($1,$2,$3)
        `, [req.params.id, line.product_id, line.qty_demand]);
      }
    }

    const result = await client.query(`
      UPDATE operations SET
        status = COALESCE($1, status),
        partner = COALESCE($2, partner),
        notes = COALESCE($3, notes),
        updated_at = NOW()
      WHERE id = $4 RETURNING *
    `, [status, partner, notes, req.params.id]);

    if (!result.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Not found' }); }

    await client.query('COMMIT');
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// POST validate (execute) operation — the critical action
router.post('/:id/validate', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock operation row
    const opResult = await client.query(
      `SELECT * FROM operations WHERE id = $1 FOR UPDATE`, [req.params.id]
    );
    if (!opResult.rows.length) throw new Error('Operation not found');

    const op = opResult.rows[0];
    if (op.status === 'done') throw new Error('Operation already validated');
    if (op.status === 'cancelled') throw new Error('Cannot validate a cancelled operation');

    // Get lines
    const lines = await client.query(
      `SELECT ol.*, p.current_stock, p.name as product_name, p.unit
       FROM operation_lines ol
       JOIN products p ON ol.product_id = p.id
       WHERE ol.operation_id = $1 FOR UPDATE OF p`, [req.params.id]
    );

    if (!lines.rows.length) throw new Error('No product lines found');

    for (const line of lines.rows) {
      const qty = parseFloat(line.qty_demand);
      let qtyChange = 0;
      let warehouseId = op.source_warehouse_id;

      if (op.type === 'receipt') {
        // Incoming — increase stock
        qtyChange = qty;
        warehouseId = op.dest_warehouse_id || op.source_warehouse_id;
      } else if (op.type === 'delivery') {
        // Outgoing — decrease stock
        if (parseFloat(line.current_stock) < qty) {
          throw new Error(`Insufficient stock for "${line.product_name}": available ${line.current_stock} ${line.unit}, needed ${qty}`);
        }
        qtyChange = -qty;
      } else if (op.type === 'transfer') {
        // Source decreases, dest increases — net zero per product
        if (parseFloat(line.current_stock) < qty) {
          throw new Error(`Insufficient stock for transfer of "${line.product_name}"`);
        }
        qtyChange = 0; // Handled below separately
      } else if (op.type === 'adjustment') {
        // Set stock to exact value
        qtyChange = qty - parseFloat(line.current_stock);
      }

      // Update product stock
      const newStock = parseFloat(line.current_stock) + (op.type === 'transfer' ? 0 : qtyChange);

      await client.query(
        `UPDATE products SET current_stock = $1, updated_at = NOW() WHERE id = $2`,
        [newStock, line.product_id]
      );

      // Update line qty_done
      await client.query(
        `UPDATE operation_lines SET qty_done = $1 WHERE id = $2`,
        [qty, line.id]
      );

      // Write ledger entry
      await client.query(`
        INSERT INTO stock_ledger (product_id, operation_id, warehouse_id, qty_change, qty_after, move_type, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [
        line.product_id, op.id, warehouseId,
        op.type === 'transfer' ? 0 : qtyChange,
        newStock,
        op.type,
        `${op.reference} — ${op.type}`
      ]);
    }

    // Mark done
    await client.query(
      `UPDATE operations SET status = 'done', done_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [op.id]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'Operation validated successfully', reference: op.reference });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// DELETE / cancel
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE operations SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status != 'done' RETURNING *`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(400).json({ success: false, error: 'Cannot cancel a done operation' });
    res.json({ success: true, message: 'Operation cancelled' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
