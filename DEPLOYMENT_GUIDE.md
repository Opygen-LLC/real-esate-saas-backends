# 🚀 Google Cloud Platform (GCP) Backend Deployment Guide

This guide provides step-by-step instructions for hosting the **Real Estate SaaS Backend** on **Google Cloud Platform (Compute Engine)** using **Docker**, **Cloud MongoDB**, **Socket.IO Realtime Engine**, and **Caddy** via Static IP (`http://34.131.86.177`).

---

## 🏗️ Architecture Overview

- **App Container (`api`)**: Node.js 22 runtime serving Express backend & Socket.IO server on port `5000`.
- **Cloud Database (`DATABASE_URL`)**: Connects to Cloud MongoDB (e.g. MongoDB Atlas / GCP Managed MongoDB) using `DATABASE_URL` in `.env`.
- **Reverse Proxy (`caddy`)**: Caddy 2 container routing port `80` to `api:5000` for REST API endpoints and Socket.IO WebSockets (`/socket.io/*`).

---

## 📋 Step 1: Initial GCP VM Instance Setup

1. **Create Compute Engine VM**:
   - Go to **GCP Console** ➔ **Compute Engine** ➔ **VM instances** ➔ **Create Instance**.
   - **Machine Type**: e2-small or e2-medium.
   - **OS**: Ubuntu 22.04 LTS or Debian 12.
   - **Firewall**: Check both **Allow HTTP traffic** and **Allow HTTPS traffic**.

2. **Reserve Static External IP**:
   - Go to **VPC Network** ➔ **IP addresses**.
   - Convert your VM's External IP from *Ephemeral* to **Static** (`34.131.86.177`).

---

## 🛠️ Step 2: Install Docker on GCP VM

SSH into your GCP VM instance and run:

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add current user to Docker group
sudo usermod -aG docker $USER
newgrp docker

# Verify Docker installation
docker --version
docker compose version
```

---

## 📁 Step 3: Configure Environment `.env`

In your GCP server project folder (`~/real-esate-saas-backends`):

```bash
nano .env
```

Ensure your `.env` contains:

```env
NODE_ENV=production
PORT=5000

# Cloud MongoDB Connection URL
DATABASE_URL=mongodb+srv://user:password@your-cluster.mongodb.net/real-estate-saas?retryWrites=true&w=majority

# Public application URLs
PUBLIC_API_URL=https://api.example.com
PUBLIC_SITE_ORIGIN=https://realestate.opygen.com
CLIENT_URL=https://realestate.opygen.com
ALLOWED_ORIGINS=https://realestate.opygen.com

# Next.js cache revalidation. Configure the exact same server-only secret in
# the frontend/Vercel project. Production startup fails if it is missing or short.
NEXT_REVALIDATE_URL=https://realestate.opygen.com/api/revalidate
NEXT_REVALIDATE_SECRET=replace_with_a_random_shared_secret_at_least_32_chars

# Modes
SMS_DEV_MODE=true
EMAIL_DEV_MODE=true
REDIS_ENABLED=false

# Security Keys (must be 32+ characters)
JWT_SECRET=real_estate_saas_jwt_secret_key_2026_super_secure_production_key_32bytes
JWT_REFRESH_SECRET=real_estate_saas_jwt_refresh_secret_key_2026_super_secure_production_key_32bytes
OTP_PEPPER=real_estate_saas_otp_pepper_super_secure_key_32bytes_min
CRON_SIGNING_SECRET=real_estate_saas_cron_signing_secret_super_secure_32bytes
DATA_ENCRYPTION_KEY=real_estate_saas_data_encryption_key_super_secure_32bytes

# GCP Bucket Credentials
PROJECTS_ID=opy-realestate-505614
BUCKET_NAME=realestate-saas
KEYFILENAME=opy-realestate-505614-d4e3b5e9f13d.json
```

---

## 🔒 Step 4: Configure Caddy (`server/Caddyfile`)

```caddy
:80 {
    reverse_proxy api:5000 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

---

## 🚀 Step 5: Launch Containers

Start the full stack with 1 command:

```bash
docker compose up -d --build
```

Verify all services are running:

```bash
docker compose ps
```

---

## 🔄 Guidelines on How to Update & Re-deploy Perfectly

Whenever you push new code changes to GitHub, SSH into your GCP server and execute:

```bash
cd ~/real-esate-saas-backends

# Step 1: Pull the latest code from GitHub
git pull origin main

# Step 2: Rebuild & restart Docker containers (1 Command)
./update.sh
```

*(Or run directly)*:
```bash
docker compose up -d --build
```

---

## 📊 Useful Operations Commands Quick Reference

| Action | Command |
|---|---|
| **View Live API Logs** | `docker compose logs -f api` |
| **View Caddy Logs** | `docker compose logs -f caddy` |
| **Check Running Status** | `docker compose ps` |
| **1-Command Redeploy** | `./update.sh` |
| **Restart Backend Container Only** | `docker compose restart api` |
| **Stop All Containers Cleanly** | `docker compose down` |

## Daily database disaster-recovery backup

Production now includes a dedicated `database-backup` service. It runs independently from API replicas, uses MongoDB Database Tools, restores every recovery point into a dated database on a separate MongoDB cluster, verifies the restore, records a SHA-256/manifest, and applies retention only after a successful verification.

Required production values:

```env
BACKUP_DATABASE_URL=mongodb+srv://...different-cluster.../backup-control
BACKUP_CRON=55 2 * * *
BACKUP_TIMEZONE=Asia/Dhaka
BACKUP_RETENTION_DAYS=30
BACKUP_MIN_RECOVERY_POINTS=7
```

Do not point `BACKUP_DATABASE_URL` at the production cluster. The production worker refuses a same-cluster target. See `docs/DATABASE_BACKUP_RUNBOOK.md` for deployment, manual smoke backup, recovery-drill, strict point-in-time consistency, and GCS media-protection guidance.



## Phase 7 rollout and recovery drill

The client defaults `NEXT_PUBLIC_PROPERTY_BACKGROUND_UPLOAD_ENABLED=true`. Set it to `false` at client build time for a rollback-safe Step-3-gated mode; Publish remains finalization-only.

Before release, run the staging DR drill only against staging with writes paused:

```bash
export NODE_ENV=staging
export BACKUP_DRILL_CONFIRM=PHASE7-STAGING-DRILL
export BACKUP_DRILL_EXPECT_QUIESCENT=true
pnpm build
pnpm backup:staging-drill
```

The drill performs the normal native `mongodump` -> empty dated database `mongorestore`, collection/count/index verification, then SHA-256 fingerprints selected critical records. Never set the drill confirmation in production. `/health` reports backup status, last successful property-draft cleanup, asset-finalization backlog and in-process finalization failure count.
