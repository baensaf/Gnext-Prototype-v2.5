# Gnext Prototype v2

Gnext Prototype v2 is a customer-validation operational prototype designed for restaurant management, point of sale (POS), kitchen display system (KDS), dine-in, delivery, cashier management, customer subledger, and operational simulation.

---

## 1. Repository Layout

- **`backend/`**: NestJS modular monolith REST API service (`src/modules/*`, TypeORM, PostgreSQL).
- **`starter-vite-ts/`**: Single-Page Application built with React, TypeScript, Vite, and MUI / MUI X.
- **`Gnext-Prototype-v1.5-Build-Specification.md`**: Primary product specification and contract.
- **`Gnext-Prototype-v1.5-Remediation-Slices.md`**: Remediation execution slices and verification criteria.

---

## 2. Tooling and Runtime Environment

- **Node.js**: `v24.18.0` (Recommended >= 22.x)
- **npm**: `11.16.0` (On Windows PowerShell, run via `npm.cmd` or `npx.cmd`)
- **Database**: PostgreSQL 16+ (Database name: `appdb`)

---

## 3. Environment Setup & Default Credentials

Copy `.env.example` to `.env` in the `backend/` directory or set environment variables accordingly:

```text
ADMIN_USERNAME=admin@gnext.local
ADMIN_PASSWORD=GnextDemo!2026
APPROVER_DEMO_PIN=2468
SEED_PROFILE=minimal
DATA_DIR=./data
DB_HOST=localhost
DB_PORT=5432
DB_USER=admin
DB_PASSWORD=admin
DB_NAME=appdb
```

### Default Prototype Credentials

- **Shared Administrator Username**: `admin@gnext.local`
- **Shared Administrator Password**: `GnextDemo!2026`
- **Operational Approver PIN**: `2468` (Argon2id hashed, used for supervisor/finance/IT approvals)

---

## 4. Startup Order

1. **PostgreSQL Database**: Ensure PostgreSQL server is active and database `appdb` exists.
2. **Backend API Service**:
   ```bash
   cd backend
   npm install
   npm run build
   npm run start:dev
   ```
3. **Frontend Application**:
   ```bash
   cd starter-vite-ts
   npm install
   npm run dev
   ```

---

## 5. Safe Development & Verification Commands

### Backend Commands
- **Lint**: `cd backend && npm run lint`
- **Typecheck & Build**: `cd backend && npm run build`
- **Unit Tests**: `cd backend && npm run test`
- **Integration Tests**: `cd backend && npm run test:e2e`

### Frontend Commands
- **Lint**: `cd starter-vite-ts && npm run lint`
- **Typecheck & Build**: `cd starter-vite-ts && npm run build`
- **Dev Server**: `cd starter-vite-ts && npm run dev`
