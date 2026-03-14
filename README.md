# CoreInventory — Full Stack Inventory Management System

A production-ready inventory management system built with **Node.js + Express + PostgreSQL** (backend) and a beautiful vanilla JS SPA (frontend).

---

## 🗂️ Project Structure

```
coreinventory/
├── backend/
│   ├── db/
│   │   └── index.js          # PostgreSQL connection + schema init
│   ├── routes/
│   │   ├── products.js        # Products CRUD API
│   │   ├── operations.js      # Receipts, Deliveries, Transfers, Adjustments API
│   │   └── misc.js            # Dashboard, Warehouses, Categories, Ledger API
│   ├── server.js              # Express entry point
│   ├── package.json
│   └── .env.example
└── frontend/
    └── index.html             # Full SPA (served by Express)
```

---

## ⚙️ Setup & Installation

### 1. Install PostgreSQL
```bash
# macOS
brew install postgresql && brew services start postgresql

# Ubuntu/Debian
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### 2. Create Database
```bash
psql -U postgres
CREATE DATABASE coreinventory;
\q
```

### 3. Install Dependencies
```bash
cd backend
npm install
```

### 4. Configure Environment
```bash
cp .env.example .env
# Edit .env with your database credentials:
# DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/coreinventory
```

### 5. Start the Server
```bash
npm start
# → http://localhost:3000
```
The database tables are created automatically on first run.

---

## 🚀 API Endpoints

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server health check |
| GET | `/api/dashboard` | Dashboard KPIs + summary |

### Products
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/products` | List all products (supports `?search=`, `?low_stock=true`, `?category=`, `?warehouse=`) |
| GET | `/api/products/:id` | Get product + ledger history |
| POST | `/api/products` | Create product |
| PUT | `/api/products/:id` | Update product |
| DELETE | `/api/products/:id` | Delete product |

### Operations (Receipts / Deliveries / Transfers / Adjustments)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/operations` | List operations (supports `?type=`, `?status=`) |
| GET | `/api/operations/:id` | Get operation + lines |
| POST | `/api/operations` | Create operation |
| PATCH | `/api/operations/:id` | Update operation |
| POST | `/api/operations/:id/validate` | **Validate — executes stock movements** |
| DELETE | `/api/operations/:id` | Cancel operation |

### Reference
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/warehouses` | List warehouses |
| POST | `/api/warehouses` | Create warehouse |
| GET | `/api/categories` | List categories |
| POST | `/api/categories` | Create category |
| GET | `/api/ledger` | Full stock ledger |

---

## 📊 Database Schema

```
warehouses        → Warehouse locations
categories        → Product categories
products          → Product catalog with current_stock
operations        → Receipts, Deliveries, Transfers, Adjustments
operation_lines   → Line items (product + qty) per operation
stock_ledger      → Immutable audit trail of every stock change
```

### Stock Logic on Validate:
- **Receipt** → `current_stock += qty`
- **Delivery** → `current_stock -= qty` (validates sufficient stock)
- **Transfer** → Source decreases, destination increases (net zero)
- **Adjustment** → `current_stock = new_qty`

All validated operations write an entry to `stock_ledger` — this is permanent and cannot be deleted.

---

## 🖥️ Frontend Pages

| Page | Description |
|------|-------------|
| Dashboard | KPIs, recent operations, low stock alerts, ledger activity |
| Products | Full CRUD with SKU, stock bar, low-stock highlight |
| Receipts | Incoming goods from vendors |
| Deliveries | Outgoing goods to customers |
| Transfers | Internal warehouse-to-warehouse moves |
| Adjustments | Physical count corrections |
| Stock Ledger | Full audit trail |
| Warehouses | Warehouse summary with product/stock counts |

---

## 🔒 Production Deployment

```bash
# Set environment variables
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@your-db-host:5432/coreinventory
PORT=3000

# Use a process manager
npm install -g pm2
pm2 start server.js --name coreinventory
pm2 save
```

Recommended cloud stack:
- **Backend + DB**: Railway, Render, or Heroku (PostgreSQL add-on included)
- **Or self-hosted**: VPS (Ubuntu) + Nginx reverse proxy + PM2

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 18+ |
| Framework | Express 4 |
| Database | PostgreSQL 14+ |
| DB Driver | node-postgres (pg) |
| Security | Helmet, CORS |
| Frontend | Vanilla JS SPA, DM Mono + Syne fonts |
# project
