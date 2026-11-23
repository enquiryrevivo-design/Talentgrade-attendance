# PeopleDesk Internal HR — Setup & Deployment Guide

## 1. Architecture Overview
- **Frontend**: React 19 + TypeScript + Tailwind CSS v4 (Mobile-first responsive layout with Light & Dark modes)
- **Backend**: Node.js + Express (`server.ts`) providing:
  - Firebase ID token verification (`firebase-admin/auth`)
  - Rate-limited `/api/*` endpoints (`express-rate-limit`)
  - Authoritative server clock endpoint (`GET /api/server-time`) for tamper-resistant attendance timestamps
  - Server-side PDF payslip rendering (`POST /api/payslips/pdf` via `pdfkit`)
- **Database & Security**: Cloud Firestore (`firebase-applet-config.json`) with hardened RBAC, transactional attendance/leave/payroll mutations, private photo storage (`attendancePhotos`), and append-only `auditLogs` enforced by `firestore.rules`.

## 2. Environment Configuration
1. Copy `.env.example` if running in a custom environment (`GEMINI_API_KEY`, `APP_URL`).
2. Ensure `firebase-applet-config.json` is present in the project root with your Firebase project configuration (`projectId`, `appId`, `apiKey`, `authDomain`, `firestoreDatabaseId`).
3. Ensure `firestore.rules` is deployed to your Firestore database.

## 3. Authentication & Initial Super Admin Setup
- **Google Sign-In** is enabled out of the box.
- On first sign-in with the bootstrapped Super Admin account, the application automatically initializes:
  - `companySettings/main` (default working hours, grace period, leave defaults, Team Leader permissions)
  - Default company departments (`Engineering`, `Operations`, `People & Finance`, `Sales & Growth`)
  - The initial `super_admin` employee record (`EMP-001`) and `roles/{uid}` entry.
- **Optional Email & Password Login**:
  - To allow employees to log in with temporary passwords generated from the Employee Directory (in addition to Google Sign-In), open **Firebase Console → Authentication → Sign-in method** and enable **Email/Password**.

## 4. Running & Building
```bash
# Install dependencies
npm install

# Development server (Express + Vite middleware on port 3000)
npm run dev

# Type-check
npm run lint

# Production build & start
npm run build
npm start
```
