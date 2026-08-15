# 🚀 Google Cloud Platform (GCP) Backend Deployment Guide

This guide provides step-by-step instructions for hosting the **Real Estate SaaS Backend** on **Google Cloud Platform (Compute Engine)** using **Docker**, **Cloud MongoDB**, and **Caddy** (for automatic HTTPS/TLS SSL certificates).

---

## 🏗️ Architecture Overview

- **App Container (`api`)**: Node.js 22 runtime serving Express backend on port `5000`.
- **Cloud Database (`DATABASE_URL`)**: Connects to Cloud MongoDB (e.g. MongoDB Atlas / GCP Managed MongoDB) using `DATABASE_URL` in `.env`.
- **Reverse Proxy (`caddy`)**: Caddy 2 container routing ports `80` & `443` to the backend with **automatic Let's Encrypt SSL certificates**.

---

## 📋 Step 1: Initial GCP VM Instance Setup

1. **Create Compute Engine VM**:
   - Go to **GCP Console** ➔ **Compute Engine** ➔ **VM instances** ➔ **Create Instance**.
   - **Machine Type**: e2-small or e2-medium.
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

# Add current user to Docker group
sudo usermod -aG docker $USER
newgrp docker

# Verify Docker installation
docker --version
docker compose version
```

---

## 📁 Step 3: Clone Code & Configure Cloud MongoDB `.env`

```bash
# 1. Clone repository from GitHub
git clone https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPOSITORY.git app
cd app/server

# 2. Configure Environment Variables
cp .env.example .env
nano .env
```

Set your **Cloud MongoDB connection URL** in `.env`:

```env
NODE_ENV=production
PORT=5000

# Cloud MongoDB URL (e.g. MongoDB Atlas / Managed GCP MongoDB)
DATABASE_URL=mongodb+srv://user:password@your-cluster.mongodb.net/real-estate-saas?retryWrites=true&w=majority

PUBLIC_API_URL=https://realestate.opygen.com
CLIENT_URL=https://realestate.opygen.com
ALLOWED_ORIGINS=*

# Security Keys (must be 32+ characters)
JWT_SECRET=real_estate_saas_jwt_secret_key_2026_super_secure_production_key_32bytes
JWT_REFRESH_SECRET=real_estate_saas_jwt_refresh_secret_key_2026_super_secure_production_key_32bytes
OTP_PEPPER=real_estate_saas_otp_pepper_super_secure_key_32bytes_min
CRON_SIGNING_SECRET=real_estate_saas_cron_signing_secret_super_secure_32bytes
DATA_ENCRYPTION_KEY=real_estate_saas_data_encryption_key_super_secure_32bytes

# SMTP Configuration
EMAIL_DEV_MODE=false
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=opygen.info@gmail.com
SMTP_PASSWORD=your-16-char-google-app-password
SMTP_FROM=opygen.info@gmail.com

# GCP Bucket Credentials
PROJECTS_ID=opy-realestate-505614
BUCKET_NAME=realestate-saas
KEYFILENAME=opy-realestate-505614-d4e3b5e9f13d.json
```

Ensure your GCP Service Account JSON keyfile is present in the `server/` directory:
`/home/faysal/Projects/opygen/Real-estate-saas/server/opy-realestate-505614-d4e3b5e9f13d.json`

---

## 🔒 Step 4: Configure Caddy

`server/Caddyfile`:

```caddy
{
    email opygen.info@gmail.com
}

realestate.opygen.com {
    reverse_proxy api:5000
}

:80 {
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

---

## 🔄 Step 6: Future Updates (GitHub Pull & Restart)

Whenever you update your backend code on GitHub, SSH into your GCP VM and run:

```bash
cd ~/app/server
./update.sh
```

Or run directly:

```bash
git pull origin main
docker compose up -d --build
```

---

## 📊 Useful Operations Commands

| Action | Command |
|---|---|
| **View Live API Logs** | `docker compose logs -f api` |
| **View Caddy SSL Logs** | `docker compose logs -f caddy` |
| **Check Running Status** | `docker compose ps` |
| **Restart API Container** | `docker compose restart api` |
| **Stop All Containers** | `docker compose down` |
