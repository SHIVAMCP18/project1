const http = require('http');

async function seed() {
  // First get categories and warehouses to map IDs
  const getJSON = (path) => new Promise((resolve, reject) => {
    http.get('http://localhost:5000/api' + path, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const postJSON = (path, body) => new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path: '/api' + path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    }, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => resolve(JSON.parse(responseData)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });

  try {
    const categoriesRes = await getJSON('/categories');
    const warehousesRes = await getJSON('/warehouses');
    
    if(!categoriesRes.success || !warehousesRes.success) {
      throw new Error("Failed to get basic data");
    }

    const catMap = {};
    categoriesRes.data.forEach(c => catMap[c.name] = c.id);
    
    const whMap = {};
    warehousesRes.data.forEach(w => whMap[w.name] = w.id);

    const products = [
      { sku: 'SKU-001', name: 'Steel Beams 10ft', cid: catMap['Steel & Metal'], unit: 'pcs', rlvl: 50, istk: 200, wid: whMap['Main Warehouse'] },
      { sku: 'SKU-002', name: 'Aluminum Sheets', cid: catMap['Steel & Metal'], unit: 'kg', rlvl: 100, istk: 500, wid: whMap['Warehouse 2'] },
      { sku: 'SKU-003', name: 'Copper Wire 2mm', cid: catMap['Electrical'], unit: 'm', rlvl: 200, istk: 1000, wid: whMap['Main Warehouse'] },
      { sku: 'SKU-004', name: 'Circuit Breakers 15A', cid: catMap['Electrical'], unit: 'pcs', rlvl: 20, istk: 80, wid: whMap['Production Floor'] },
      { sku: 'SKU-005', name: 'Cardboard Boxes L', cid: catMap['Packaging'], unit: 'pcs', rlvl: 500, istk: 2000, wid: whMap['Warehouse 2'] },
      { sku: 'SKU-006', name: 'Bubble Wrap Roll', cid: catMap['Packaging'], unit: 'roll', rlvl: 10, istk: 30, wid: whMap['Main Warehouse'] },
      { sku: 'SKU-007', name: 'Industrial Solvent', cid: catMap['Chemical'], unit: 'L', rlvl: 50, istk: 150, wid: whMap['Production Floor'] },
      { sku: 'SKU-008', name: 'Lubricant Oil', cid: catMap['Chemical'], unit: 'L', rlvl: 20, istk: 75, wid: whMap['Warehouse 2'] },
      { sku: 'SKU-009', name: 'Machine Bearings', cid: catMap['Spare Parts'], unit: 'pcs', rlvl: 100, istk: 300, wid: whMap['Main Warehouse'] },
      { sku: 'SKU-010', name: 'Conveyor Belts', cid: catMap['Spare Parts'], unit: 'm', rlvl: 5, istk: 15, wid: whMap['Production Floor'] }
    ];

    for (const p of products) {
      if (p.cid && p.wid) {
        try {
          await postJSON('/products', {
            sku: p.sku,
            name: p.name,
            category_id: p.cid,
            unit: p.unit,
            reorder_level: p.rlvl,
            initial_stock: p.istk,
            warehouse_id: p.wid
          });
          console.log(`Added ${p.sku} via API`);
        } catch(e) {
          console.log(`Error adding ${p.sku}: ${e.message}`);
        }
      } else {
        console.log(`Skipped ${p.sku} due to missing category or warehouse ID`);
      }
    }
    console.log('Finished seeding process!');
  } catch(e) {
    console.error('Master error:', e);
  }
}

seed();
