const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET all warehouses
router.get('/warehouses', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT w.*,
        COUNT(DISTINCT p.id) as product_count,
        SUM(p.current_stock) as total_stock
      FROM warehouses w
      LEFT JOIN products p ON p.warehouse_id = w.id
      GROUP BY w.id ORDER BY w.name
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET all categories
router.get('/categories', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, COUNT(p.id) as product_count
      FROM categories c LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id ORDER BY c.name
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST create category
router.post('/categories', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'Name required' });
  try {
    const result = await pool.query(`INSERT INTO categories (name) VALUES ($1) RETURNING *`, [name]);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ success: false, error: 'Category already exists' });
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST create warehouse
router.post('/warehouses', async (req, res) => {
  const { name, location } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'Name required' });
  try {
    const result = await pool.query(`INSERT INTO warehouses (name, location) VALUES ($1,$2) RETURNING *`, [name, location || null]);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET dashboard summary
router.get('/dashboard', async (req, res) => {
  try {
    const [products, lowStock, pendingReceipts, pendingDeliveries, pendingTransfers, recentOps, ledger] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM products`),
      pool.query(`SELECT COUNT(*) FROM products WHERE current_stock <= reorder_level`),
      pool.query(`SELECT COUNT(*) FROM operations WHERE type = 'receipt' AND status IN ('draft','ready')`),
      pool.query(`SELECT COUNT(*) FROM operations WHERE type = 'delivery' AND status IN ('draft','ready')`),
      pool.query(`SELECT COUNT(*) FROM operations WHERE type = 'transfer' AND status IN ('draft','ready')`),
      pool.query(`
        SELECT o.reference, o.type, o.status, o.created_at,
          sw.name as source_warehouse_name, dw.name as dest_warehouse_name
        FROM operations o
        LEFT JOIN warehouses sw ON o.source_warehouse_id = sw.id
        LEFT JOIN warehouses dw ON o.dest_warehouse_id = dw.id
        ORDER BY o.created_at DESC LIMIT 10
      `),
      pool.query(`
        SELECT sl.*, p.name as product_name, p.sku, p.unit, w.name as warehouse_name
        FROM stock_ledger sl
        JOIN products p ON sl.product_id = p.id
        LEFT JOIN warehouses w ON sl.warehouse_id = w.id
        ORDER BY sl.created_at DESC LIMIT 15
      `)
    ]);

    // Stock by category
    const stockByCategory = await pool.query(`
      SELECT c.name, SUM(p.current_stock) as total, COUNT(p.id) as count
      FROM categories c LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.name ORDER BY total DESC NULLS LAST
    `);

    // Low stock products
    const lowStockProducts = await pool.query(`
      SELECT p.sku, p.name, p.current_stock, p.reorder_level, p.unit, w.name as warehouse_name
      FROM products p LEFT JOIN warehouses w ON p.warehouse_id = w.id
      WHERE p.current_stock <= p.reorder_level
      ORDER BY p.current_stock ASC LIMIT 10
    `);

    res.json({
      success: true,
      data: {
        kpis: {
          total_products: parseInt(products.rows[0].count),
          low_stock: parseInt(lowStock.rows[0].count),
          pending_receipts: parseInt(pendingReceipts.rows[0].count),
          pending_deliveries: parseInt(pendingDeliveries.rows[0].count),
          pending_transfers: parseInt(pendingTransfers.rows[0].count),
        },
        stock_by_category: stockByCategory.rows,
        low_stock_products: lowStockProducts.rows,
        recent_operations: recentOps.rows,
        recent_ledger: ledger.rows
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET stock ledger
router.get('/ledger', async (req, res) => {
  try {
    const { product_id, limit = 50 } = req.query;
    let query = `
      SELECT sl.*, p.name as product_name, p.sku, p.unit,
        o.reference, w.name as warehouse_name
      FROM stock_ledger sl
      JOIN products p ON sl.product_id = p.id
      LEFT JOIN operations o ON sl.operation_id = o.id
      LEFT JOIN warehouses w ON sl.warehouse_id = w.id
      WHERE 1=1
    `;
    const params = [];
    if (product_id) { params.push(product_id); query += ` AND sl.product_id = $${params.length}`; }
    query += ` ORDER BY sl.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
