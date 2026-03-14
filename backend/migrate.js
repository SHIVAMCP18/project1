require('dotenv').config();
const { pool, initDB } = require('./db');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // We need to drop these tables because we changed a column type (partner) from varchar to UUID
    // and added source_document. It's easiest to drop since it's early.
    await client.query('DROP TABLE IF EXISTS stock_ledger CASCADE');
    await client.query('DROP TABLE IF EXISTS operation_lines CASCADE');
    await client.query('DROP TABLE IF EXISTS operations CASCADE');
    
    // Add short_code to warehouses if it doesn't exist
    try {
      await client.query('ALTER TABLE warehouses ADD COLUMN short_code VARCHAR(10) UNIQUE');
      console.log('Added short_code to warehouses');
    } catch(e) {
      console.log('Notice: ' + e.message);
    }

    await client.query('COMMIT');
    console.log('Migration prep complete.');
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration error:', err);
    process.exit(1);
  } finally {
    client.release();
  }

  // Re-init the database to create the new tables
  try {
    await initDB();
    console.log('DB re-initialized with new schema');
    process.exit(0);
  } catch(e) {
    console.error('Init error:', e);
    process.exit(1);
  }
})();
