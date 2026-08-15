# 🚀 Google Cloud Platform (GCP) Backend Deployment & Update Guide

This guide provides step-by-step instructions for hosting the **Real Estate SaaS Backend** on **Google Cloud Platform (Compute Engine)** using **Docker**, **Docker Compose**, and **Caddy** (for automatic HTTPS/TLS SSL certificates).

---

## 🏗️ Architecture Overview

- **App Container (`api`)**: Node.js 22 runtime serving Express backend on port `5000`.
- **Database Container (`mongo`)**: MongoDB 7.0 with replica set `rs0` enabled.
- **Cache Container (`redis`)**: Redis 7.4 with password authentication.
- **Reverse Proxy (`caddy`)**: Caddy 2 container routing ports `80` & `443` to the backend with **automatic Let's Encrypt SSL certificates**.

---

## 📋 Step 1: Initial GCP VM Instance Setup

1. **Create Compute Engine VM**:
   - Go to **GCP Console** ➔ **Compute Engine** ➔ **VM instances** ➔ **Create Instance**.
   - **Machine Type**: e2-small or e2-medium (2 vCPU, 4GB RAM recommended).
   - **OS**: Ubuntu 22.04 LTS or Debian 12.
   - **Firewall**: Check both **Allow HTTP traffic** and **Allow HTTPS traffic**.

2. **Reserve Static External IP**:
   - Go to **VPC Network** ➔ **IP addresses**.
   - Convert your VM's External IP from *Ephemeral* to **Static**.

3. **Configure DNS**:
   - Go to your domain DNS provider (Cloudflare, Namecheap, GoDaddy, etc.).
   - Create an **`A` Record**:
     - **Name**: `realestate` (or `@` for apex domain)
     - **Value**: Your GCP Static IP address (e.g. `34.xxx.xxx.xxx`)

---

## 🛠️ Step 2: Install Docker on GCP VM

SSH into your GCP VM instance and run:

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add current user to Docker group (allows running docker without sudo)
sudo usermod -aG docker $USER
newgrp docker

# Verify Docker installation
docker --version
docker compose version
```

---

## 📁 Step 3: Clone Code & Configure Environment

```bash
# 1. Clone repository from GitHub
git clone https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPOSITORY.git app
cd app/server

# 2. Configure Environment Variables
cp .env.example .env
nano .env
```

Ensure your production `.env` contains:

```env
NODE_ENV=production
PORT=5000

DATABASE_URL=mongodb://mongo:27017/real-estate-saas?replicaSet=rs0
PUBLIC_API_URL=https://realestate.opygen.com
CLIENT_URL=https://realestate.opygen.com
ALLOWED_ORIGINS=*

# Security Keys (must be 32+ characters)
JWT_SECRET=real_estate_saas_jwt_secret_key_2026_super_secure_production_key_32bytes
JWT_REFRESH_SECRET=real_estate_saas_jwt_refresh_secret_key_2026_super_secure_production_key_32bytes
OTP_PEPPER=real_estate_saas_otp_pepper_super_secure_key_32bytes_min
CRON_SIGNING_SECRET=real_estate_saas_cron_signing_secret_super_secure_32bytes
DATA_ENCRYPTION_KEY=real_estate_saas_data_encryption_key_super_secure_32bytes

# Redis Config
REDIS_PASSWORD=your_secure_redis_password_here

# SMTP Configuration
EMAIL_DEV_MODE=false
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=opygen.info@gmail.com
SMTP_PASSWORD=your-16-char-google-app-password
SMTP_FROM=opygen.info@gmail.com

# GCP Credentials
PROJECTS_ID=opy-realestate-505614
BUCKET_NAME=realestate-saas
KEYFILENAME=opy-realestate-505614-d4e3b5e9f13d.json
```

Ensure your GCP Service Account JSON keyfile is present in the `server/` directory:
`/home/faysal/Projects/opygen/Real-estate-saas/server/opy-realestate-505614-d4e3b5e9f13d.json`

---

## 🔒 Step 4: Configure Caddy (Automatic HTTPS)

The `Caddyfile` is configured at `server/Caddyfile`:

```caddy
{
    email opygen.info@gmail.com
}

realestate.opygen.com {
    reverse_proxy api:5000
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

Expected Output:
```text
NAME                     STATUS              PORTS
server-api-1             running (healthy)   127.0.0.1:5000->5000/tcp
server-caddy-1           running             0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp
server-mongo-1           running (healthy)   
server-redis-1           running (healthy)   
```

Test your live backend:
```bash
curl https://realestate.opygen.com/ready
```

---

## 🔄 Step 6: Future Updates (Pull Code & Restart)

Whenever you push new code changes to GitHub, SSH into your GCP VM and execute this 2-step update command:

```bash
cd ~/app/server
git pull origin main
docker compose up -d --build
```

### ⚡ Optional: 1-Click Update Script

You can create an `update.sh` script in `server/`:

```bash
nano update.sh
```

Paste the following:

```bash
#!/bin/bash
set -e
echo "🔄 Pulling latest backend code from GitHub..."
git pull origin main

echo "🏗️ Rebuilding & restarting Docker containers..."
docker compose up -d --build

echo "✅ Backend updated successfully!"
docker compose ps
```

Make it executable:

```bash
chmod +x update.sh
```

Future updates can be run with just:

```bash
./update.sh
```

---

## 📊 Useful Operations Commands

| Action | Command |
|---|---|
| **View Live API Logs** | `docker compose logs -f api` |
| **View Caddy Logs** | `docker compose logs -f caddy` |
| **View All Container Logs** | `docker compose logs -f` |
| **Check Container Health** | `docker compose ps` |
| **Restart Backend Container Only** | `docker compose restart api` |
| **Stop All Services** | `docker compose down` |
