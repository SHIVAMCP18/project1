const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const initDB = async () => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Enable extension for UUID generation
    await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // Partners
    await client.query(`
      CREATE TABLE IF NOT EXISTS partners (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL UNIQUE,
        email VARCHAR(255),
        phone VARCHAR(50),
        address TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Warehouses
    await client.query(`
      CREATE TABLE IF NOT EXISTS warehouses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL UNIQUE,
        short_code VARCHAR(10) UNIQUE,
        location VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Categories
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Products
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sku VARCHAR(100) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        category_id UUID REFERENCES categories(id),
        unit VARCHAR(50) NOT NULL DEFAULT 'pcs',
        reorder_level NUMERIC(12,2) DEFAULT 0,
        initial_stock NUMERIC(12,2) DEFAULT 0,
        current_stock NUMERIC(12,2) DEFAULT 0,
        warehouse_id UUID REFERENCES warehouses(id),
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Operations
    await client.query(`
      CREATE TABLE IF NOT EXISTS operations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reference VARCHAR(100) NOT NULL UNIQUE,
        source_document VARCHAR(100),
        type VARCHAR(50) NOT NULL CHECK (type IN ('receipt','delivery','transfer','adjustment')),
        status VARCHAR(50) NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft','ready','done','cancelled')),
        source_warehouse_id UUID REFERENCES warehouses(id),
        dest_warehouse_id UUID REFERENCES warehouses(id),
        partner_id UUID REFERENCES partners(id),
        notes TEXT,
        scheduled_date DATE,
        done_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Operation Lines
    await client.query(`
      CREATE TABLE IF NOT EXISTS operation_lines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        operation_id UUID NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products(id),
        qty_demand NUMERIC(12,2) NOT NULL DEFAULT 0,
        qty_done NUMERIC(12,2) DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Stock Ledger
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_ledger (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID NOT NULL REFERENCES products(id),
        operation_id UUID REFERENCES operations(id),
        warehouse_id UUID REFERENCES warehouses(id),
        qty_change NUMERIC(12,2) NOT NULL,
        qty_after NUMERIC(12,2) NOT NULL,
        move_type VARCHAR(50) NOT NULL,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Seed data
    await client.query(`
      INSERT INTO warehouses (name, location)
      VALUES
        ('Main Warehouse','Building A'),
        ('Warehouse 2','Building B'),
        ('Production Floor','Building C')
      ON CONFLICT DO NOTHING
    `);

    await client.query(`
      INSERT INTO categories (name)
      VALUES
        ('Steel & Metal'),
        ('Electrical'),
        ('Packaging'),
        ('Chemical'),
        ('Spare Parts')
      ON CONFLICT DO NOTHING
    `);

    await client.query('COMMIT');

    console.log('✅ Database initialized successfully');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ DB init error:', err.message);
    throw err;

  } finally {
    client.release();
  }
};

module.exports = { pool, initDB };
