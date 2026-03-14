require('dotenv').config();
const { pool } = require('./db');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Get all warehouses sorted by created_at
    const whRes = await client.query('SELECT id, name FROM warehouses ORDER BY name, created_at ASC');
    const keepIds = {}; // name -> id to keep
    const remap = {};   // old_id -> new_id
    
    for (let row of whRes.rows) {
      if (!keepIds[row.name]) {
        keepIds[row.name] = row.id;
      } else {
        remap[row.id] = keepIds[row.name];
      }
    }
    
    console.log('Keeping:', keepIds);
    console.log('Remapping:', Object.keys(remap).length, 'duplicates');
    
    // Update references
    for (const [oldId, newId] of Object.entries(remap)) {
      await client.query('UPDATE products SET warehouse_id = $1 WHERE warehouse_id = $2', [newId, oldId]);
      await client.query('UPDATE operations SET source_warehouse_id = $1 WHERE source_warehouse_id = $2', [newId, oldId]);
      await client.query('UPDATE operations SET dest_warehouse_id = $1 WHERE dest_warehouse_id = $2', [newId, oldId]);
      await client.query('UPDATE stock_ledger SET warehouse_id = $1 WHERE warehouse_id = $2', [newId, oldId]);
      await client.query('DELETE FROM warehouses WHERE id = $1', [oldId]);
    }
    
    // Check if unique constraint exists
    try {
      await client.query('ALTER TABLE warehouses ADD CONSTRAINT warehouses_name_key UNIQUE (name)');
      console.log('Added UNIQUE constraint to warehouses.name');
    } catch(e) {
      console.log('Notice: ' + e.message);
    }
    
    await client.query('COMMIT');
    console.log('Database cleanup complete.');
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
  }
})();
