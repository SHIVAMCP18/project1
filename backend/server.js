require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { initDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({ 
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      "script-src-attr": ["'self'", "'unsafe-inline'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' } 
}));
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use(morgan('dev'));

// Static frontend
const path = require('path');
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../frontend/login.html')));
app.use(express.static(path.join(__dirname, '../frontend')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/operations', require('./routes/operations'));
app.use('/api', require('./routes/misc'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// 404 handler
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Start
const start = async () => {
  try {
    await initDB();
    app.listen(PORT, () => {
      console.log(`\n🚀 CoreInventory API running at http://localhost:${PORT}`);
      console.log(`📦 Endpoints:`);
      console.log(`   GET  /api/health`);
      console.log(`   GET  /api/dashboard`);
      console.log(`   GET  /api/products`);
      console.log(`   POST /api/products`);
      console.log(`   GET  /api/operations`);
      console.log(`   POST /api/operations`);
      console.log(`   POST /api/operations/:id/validate`);
      console.log(`   GET  /api/warehouses`);
      console.log(`   GET  /api/categories`);
      console.log(`   GET  /api/ledger\n`);
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
};

start();
