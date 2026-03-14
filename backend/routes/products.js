const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET all products
router.get('/', async (req, res) => {
  try {
    const { search, category, warehouse, low_stock } = req.query;
    let query = `
      SELECT p.*, c.name as category_name, w.name as warehouse_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN warehouses w ON p.warehouse_id = w.id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`;
    }
    if (category) {
      params.push(category);
      query += ` AND p.category_id = $${params.length}`;
    }
    if (warehouse) {
      params.push(warehouse);
      query += ` AND p.warehouse_id = $${params.length}`;
    }
    if (low_stock === 'true') {
      query += ` AND p.current_stock <= p.reorder_level`;
    }
    query += ' ORDER BY p.created_at DESC';

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows, total: result.rowCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET single product
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, c.name as category_name, w.name as warehouse_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN warehouses w ON p.warehouse_id = w.id
      WHERE p.id = $1
    `, [req.params.id]);

    if (!result.rows.length) return res.status(404).json({ success: false, error: 'Product not found' });

    // Get recent ledger
    const ledger = await pool.query(`
      SELECT sl.*, o.reference, o.type as op_type
      FROM stock_ledger sl
      LEFT JOIN operations o ON sl.operation_id = o.id
      WHERE sl.product_id = $1
      ORDER BY sl.created_at DESC LIMIT 20
    `, [req.params.id]);

    res.json({ success: true, data: { ...result.rows[0], ledger: ledger.rows } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST create product
router.post('/', async (req, res) => {
  const { sku, name, category_id, unit, reorder_level, initial_stock, warehouse_id, description } = req.body;
  if (!sku || !name) return res.status(400).json({ success: false, error: 'SKU and name are required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      INSERT INTO products (sku, name, category_id, unit, reorder_level, initial_stock, current_stock, warehouse_id, description)
      VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8) RETURNING *
    `, [sku, name, category_id || null, unit || 'pcs', reorder_level || 0, initial_stock || 0, warehouse_id || null, description || null]);

    const product = result.rows[0];

    // Log initial stock in ledger
    if (initial_stock > 0) {
      await client.query(`
        INSERT INTO stock_ledger (product_id, warehouse_id, qty_change, qty_after, move_type, notes)
        VALUES ($1,$2,$3,$4,'initial','Initial stock on product creation')
      `, [product.id, warehouse_id || null, initial_stock, initial_stock]);
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: product });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ success: false, error: 'SKU already exists' });
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// PUT update product
router.put('/:id', async (req, res) => {
  const { name, category_id, unit, reorder_level, warehouse_id, description } = req.body;
  try {
    const result = await pool.query(`
      UPDATE products SET
        name = COALESCE($1, name),
        category_id = COALESCE($2, category_id),
        unit = COALESCE($3, unit),
        reorder_level = COALESCE($4, reorder_level),
        warehouse_id = COALESCE($5, warehouse_id),
        description = COALESCE($6, description),
        updated_at = NOW()
      WHERE id = $7 RETURNING *
    `, [name, category_id, unit, reorder_level, warehouse_id, description, req.params.id]);

    if (!result.rows.length) return res.status(404).json({ success: false, error: 'Product not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE product
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'Product not found' });
    res.json({ success: true, message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
