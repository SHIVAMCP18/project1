require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const { initDB } = require('./db');
const { initUsersTable } = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;


/* Middleware */

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        "script-src-attr": ["'self'", "'unsafe-inline'"]
      }
    },
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);

app.use(cors({
  origin: process.env.FRONTEND_URL || "*"
}));

app.use(express.json());
app.use(morgan("dev"));


/* Static frontend */

app.get('/login', (req,res)=>{
  res.sendFile(path.join(__dirname,'../frontend/login.html'));
});

app.use(express.static(path.join(__dirname,'../frontend')));


/* Routes */

app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/operations', require('./routes/operations'));
app.use('/api', require('./routes/misc'));


/* Health check */

app.get('/api/health',(req,res)=>{
  res.json({
    status:'ok',
    version:'1.0.0',
    timestamp:new Date().toISOString()
  });
});


/* 404 */

app.use('/api/*',(req,res)=>{
  res.status(404).json({
    success:false,
    error:'Endpoint not found'
  });
});


/* Error handler */

app.use((err,req,res,next)=>{
  console.error(err.stack);

  res.status(500).json({
    success:false,
    error:'Internal server error'
  });
});


/* Start server */

const start = async () => {

  try {

    await initDB();
    await initUsersTable();

    app.listen(PORT,()=>{
      console.log(`🚀 CoreInventory API running on port ${PORT}`);
    });

  } catch(err) {

    console.error("Failed to start server:",err.message);
    process.exit(1);

  }

};

start();
