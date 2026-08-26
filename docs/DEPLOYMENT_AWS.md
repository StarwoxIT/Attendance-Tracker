# Deploying to AWS (EC2 + RDS)

This is the AWS-specific instantiation of [docs/SELF_HOSTING.md](SELF_HOSTING.md): one
EC2 instance running the same `docker-compose.yml` (`app`, `migrate`, `cron`, `nginx`)
used for any self-hosted deployment, pointed at RDS for Postgres and S3 for object
storage instead of a local/native Postgres and local disk. Nothing about the compose
file changes between local dev and this — only `.env`'s values do. Read SELF_HOSTING.md
first — this doc only covers what's AWS-specific: provisioning RDS/S3/EC2, security
groups, and IAM.

## Architecture

```
(Elastic IP, no domain yet) → EC2 instance
                                 ├─ nginx      (container, deploy/nginx.conf, port 80)
                                 ├─ app        (Next.js, container, port 3000 — behind nginx)
                                 ├─ cron       (container, hits app's /api/cron/*)
                                 └─ migrate    (container, runs once per deploy)
                                        │
                                        ├──→ RDS PostgreSQL  (private subnet, SG-restricted)
                                        └──→ S3 bucket        (via instance IAM role)
```

`nginx` is a container in the same `docker-compose.yml` as `app` (not host-installed) —
see the compose file's own comment on why it's required even before you have a domain
or TLS: it's what makes `TRUSTED_IP_HEADER` trustworthy at all. No domain/Route 53/cert
is needed to go live — access the app at `http://<elastic-ip>/` and add a domain + TLS
later by swapping in `deploy/nginx.https.conf.example` (§4).

One instance is enough for this app's scale (a single-office SME's attendance system) —
this doc does not cover ALB/ECS/multi-AZ. If you outgrow one box, the app is already
container-based, so moving to ECS/Fargate later is a smaller step than starting there.

## 1. RDS (PostgreSQL)

1. RDS console → **Create database** → PostgreSQL, version 16.x (matches `docker-compose`'s
   local Postgres and `prisma/schema.prisma`'s target).
2. Instance class: `db.t4g.micro` is enough to start; scale up if reports/exports get slow.
3. **Not publicly accessible.** The app reaches it over the VPC only.
4. Create a dedicated security group for RDS. Inbound rule: **port 5432 from the EC2
   instance's security group only** (reference the SG, not a CIDR/IP) — never open 5432 to
   0.0.0.0/0.
5. Enable automated backups (7+ days retention) and storage autoscaling.
6. Note the endpoint hostname, port, master username/password, and DB name.

Build the connection string:

```
DATABASE_URL="postgresql://<user>:<password>@<rds-endpoint>:5432/attendance?schema=public&sslmode=require"
```

RDS's default parameter group accepts both plain and TLS connections; `sslmode=require`
pins the app to TLS. There's no separate pooled/direct split like Neon here — set
`DIRECT_URL` to the **same value** (see [docs/DATABASE.md](DATABASE.md)).

## 2. S3 (object storage)

1. Create a bucket (block all public access — files are served back through the app's own
   `/api/blob/[...key]` route, never directly from S3).
2. Create an IAM policy scoped to that bucket:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
       "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
     }]
   }
   ```
3. Attach that policy to an **IAM role**, and attach the role to the EC2 instance as its
   instance profile — do **not** create an IAM user with static access keys for this.
   `src/lib/storage/drivers/s3.ts` only sets explicit credentials when
   `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` are set; leaving both unset makes the AWS SDK
   fall back to the instance's role automatically.
4. Set in `.env`:
   ```
   STORAGE_DRIVER="s3"
   S3_BUCKET="your-bucket-name"
   S3_REGION="us-east-1"          # match the bucket's region
   S3_ENDPOINT=""                  # leave unset for real AWS S3
   S3_FORCE_PATH_STYLE=""          # leave unset for real AWS S3 (MinIO-only setting)
   S3_ACCESS_KEY_ID=""             # leave unset — use the instance role instead
   S3_SECRET_ACCESS_KEY=""         # leave unset — use the instance role instead
   ```

## 3. EC2

1. Launch an instance — Amazon Linux 2023 or Ubuntu 22.04+, `t3.small` is a reasonable
   starting point (bump to `t3.medium` if builds/reports feel slow).
2. Attach the IAM role from step 2.
3. Allocate and associate an **Elastic IP** so the address survives instance stop/start.
4. Security group: inbound 80 from `0.0.0.0/0` (add 443 later once you have a domain +
   cert), inbound 22 restricted to your own IP/VPN — never leave SSH open to the world.
   No inbound rule for 3000/5432 (the app port is bound to `127.0.0.1` in
   `docker-compose.yml`, reached only by the `nginx` container over the internal Docker
   network; RDS is reached privately).
5. Install Docker + the Compose plugin:
   ```bash
   # Amazon Linux 2023
   sudo dnf install -y docker
   sudo systemctl enable --now docker
   sudo usermod -aG docker $USER    # re-login after this
   DOCKER_CONFIG=${DOCKER_CONFIG:-$HOME/.docker}
   mkdir -p $DOCKER_CONFIG/cli-plugins
   curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
     -o $DOCKER_CONFIG/cli-plugins/docker-compose
   chmod +x $DOCKER_CONFIG/cli-plugins/docker-compose
   ```
   Nothing else to install for nginx/TLS right now — `docker-compose.yml` already runs
   nginx as a container, and `deploy/nginx.conf` (plain HTTP, no domain required) is what
   it loads by default.

## 4. Deploy the app

```bash
git clone <your-repo-url> attendance && cd attendance
cp .env.example .env
# fill in: DATABASE_URL/DIRECT_URL (step 1), APP_URL/NEXT_PUBLIC_APP_URL (your domain),
# AUTH_SECRET, QR_SECRET, NETWORK_AGENT_SECRET, CRON_SECRET (openssl rand -base64 48 each),
# STORAGE_DRIVER=s3 + S3_* (step 2), TRUSTED_IP_HEADER=x-real-ip (see below),
# SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD (see below)

docker compose build
docker compose up -d migrate   # applies prisma/migrations (creates the schema from
                                 # scratch on the empty RDS database on first run, or
                                 # just the new migrations on subsequent deploys), then
                                 # ensures the SEED_ADMIN_* super admin exists — both
                                 # steps are safe to re-run on every deploy
docker compose up -d           # starts app, cron, nginx
```

Setting `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` is enough — `migrate` creates that
`SUPER_ADMIN` automatically and skips it on later runs once the account already exists
(`prisma/seed.ts`), no separate seed command needed.

Open `http://<elastic-ip>/` — that's it, no domain or cert needed to be live. Set
`APP_URL`/`NEXT_PUBLIC_APP_URL` in `.env` to that same `http://<elastic-ip>` for now;
update both (and re-deploy) once you attach a real domain.

**`TRUSTED_IP_HEADER=x-real-ip` is the one setting that must be right before this app can
be trusted for office-network verification** — nginx overwrites `X-Real-IP` from the real
TCP connection, so a client can't forge it. Full explanation in
[docs/SELF_HOSTING.md §1](SELF_HOSTING.md#1-the-one-security-critical-setting-trusted_ip_header).
Test by clocking in from off the office network and confirming it's denied.

### Adding a domain + TLS later

1. Point Route 53 (or your DNS provider) at the Elastic IP.
2. Open port 443 in the EC2 security group.
3. Copy `deploy/nginx.https.conf.example` over `deploy/nginx.conf`, fill in your domain
   and cert paths.
4. Run `certbot --nginx` (or `certbot certonly` + a bind-mounted cert volume) against the
   `nginx` container — bare IP addresses can't get a Let's Encrypt cert, which is why this
   step waits until you have a domain.
5. `docker compose restart nginx`, then update `APP_URL`/`NEXT_PUBLIC_APP_URL` to
   `https://your-domain` and redeploy `app`.

## 5. Redeploys

```bash
git pull
docker compose build
docker compose up -d migrate   # applies any new migrations, exits
docker compose up -d           # recreates app/cron with the new image
```

## 6. Operations

- **Logs**: `docker compose logs -f app` (add `cron`/`migrate` as needed).
- **Health**: the `app` container has a Docker `HEALTHCHECK` that hits `/` (touches the DB) —
  `docker ps` shows `(healthy)`/`(unhealthy)`; combine with `restart: unless-stopped` for
  automatic recovery from a crashed process.
- **Backups**: RDS automated snapshots (step 1) cover the database; S3 has its own
  durability — enable versioning on the bucket if you want extra protection against
  accidental overwrites.
- **Monitoring**: the CloudWatch agent on the instance (optional) covers CPU/disk/memory;
  there's no app-level metrics endpoint beyond the `HEALTHCHECK` above.

## Local development

AWS is not required for local dev, and `docker-compose.yml` is the same file you'd use in
production — no separate local-only compose file. See the
[README](../README.md#quick-start-local-development) and [docs/DATABASE.md](DATABASE.md):
any reachable Postgres works (a native local install, Neon, or a Postgres container you
run and manage yourself). If Postgres runs on the same machine as Docker,
`DATABASE_URL`'s host should be `host.docker.internal`, not `localhost` — the app runs
inside a container, so `localhost` there means the container itself.
