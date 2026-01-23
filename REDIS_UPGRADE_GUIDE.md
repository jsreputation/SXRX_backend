# Redis Upgrade Guide

## Current Status

- **Current Version:** Redis 6.0.16
- **Recommended Version:** Redis 6.2.0 or later (latest stable: 7.x)
- **Status:** ⚠️ **Upgrade Recommended** - 6.0.16 has security vulnerabilities and is no longer supported

## Why Upgrade?

1. **Security:** Redis 6.0.16 has known CVEs that are fixed in 6.2.0+
2. **Support:** 6.0.x versions no longer receive security patches
3. **Performance:** 6.2.0+ includes performance improvements
4. **Compatibility:** Your application uses only standard Redis commands (fully compatible)

## Pre-Upgrade Checklist

- [ ] Backup Redis data (if you have important data)
- [ ] Check current Redis version: `redis-cli --version`
- [ ] Verify Redis is running: `redis-cli ping`
- [ ] Stop the backend application: `pm2 stop sxrx-backend`

## Upgrade Instructions

### Option 1: Ubuntu/Debian (Recommended)

```bash
# 1. Stop Redis
sudo systemctl stop redis-server

# 2. Backup Redis data (optional but recommended)
sudo cp -r /var/lib/redis /var/lib/redis.backup

# 3. Update package list
sudo apt update

# 4. Install Redis 6.2+ (or latest stable)
sudo apt install redis-server

# 5. Verify new version
redis-cli --version
# Should show: redis-cli 6.2.x or higher

# 6. Start Redis
sudo systemctl start redis-server

# 7. Verify Redis is running
redis-cli ping
# Should return: PONG

# 8. Restart backend
pm2 restart sxrx-backend
```

### Option 2: Install Latest Redis (7.x)

If you want the latest features:

```bash
# 1. Stop Redis
sudo systemctl stop redis-server

# 2. Add Redis official repository
curl -fsSL https://packages.redis.io/gpg | sudo gpg --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg

echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/redis.list

# 3. Update and install
sudo apt update
sudo apt install redis

# 4. Start Redis
sudo systemctl start redis-server

# 5. Verify
redis-cli --version
redis-cli ping
```

### Option 3: Compile from Source

```bash
# 1. Download Redis 6.2.x or 7.x
cd /tmp
wget https://download.redis.io/redis-stable.tar.gz
tar xzf redis-stable.tar.gz
cd redis-stable

# 2. Compile
make

# 3. Install
sudo make install

# 4. Update systemd service (if needed)
sudo systemctl daemon-reload
sudo systemctl restart redis-server
```

## Post-Upgrade Verification

1. **Check Version:**
   ```bash
   redis-cli --version
   # Should show 6.2.x or higher
   ```

2. **Test Connection:**
   ```bash
   redis-cli ping
   # Should return: PONG
   ```

3. **Check Backend Logs:**
   ```bash
   pm2 logs sxrx-backend --lines 20
   # Should see: [CACHE] Redis connected
   # Should see: [CACHE] Redis ready
   # Should NOT see Redis version warnings
   ```

4. **Test API Endpoints:**
   ```bash
   curl http://localhost:5000/health
   # Should return health status with redis: "connected"
   ```

5. **Verify Caching Works:**
   ```bash
   # Make a request that uses cache
   # Check Redis for cached keys
   redis-cli KEYS "sxrx:*"
   ```

## Rollback Plan (If Needed)

If you encounter issues after upgrade:

```bash
# 1. Stop Redis
sudo systemctl stop redis-server

# 2. Restore backup (if you made one)
sudo rm -rf /var/lib/redis
sudo cp -r /var/lib/redis.backup /var/lib/redis
sudo chown -R redis:redis /var/lib/redis

# 3. Reinstall old version
sudo apt remove redis-server
sudo apt install redis-server=6.0.16-*  # Adjust version as needed

# 4. Start Redis
sudo systemctl start redis-server

# 5. Restart backend
pm2 restart sxrx-backend
```

## Compatibility Notes

Your application uses only standard Redis commands that are fully compatible:
- ✅ `GET`, `SET`, `SETEX` - Basic operations
- ✅ `INCR`, `TTL` - Counters and expiration
- ✅ `DEL`, `KEYS` - Deletion and pattern matching
- ✅ `EXISTS` - Key existence checks

**No breaking changes expected** - all these commands work identically in 6.0.16 and 6.2.0+.

## Troubleshooting

### Issue: Redis won't start after upgrade

**Solution:**
```bash
# Check Redis logs
sudo journalctl -u redis-server -n 50

# Check Redis config
sudo redis-cli CONFIG GET "*"

# Fix permissions if needed
sudo chown -R redis:redis /var/lib/redis
sudo chmod 750 /var/lib/redis
```

### Issue: Backend can't connect to Redis

**Solution:**
```bash
# Verify Redis is listening
sudo netstat -tlnp | grep 6379

# Check Redis bind address
sudo grep "^bind" /etc/redis/redis.conf

# Test connection manually
redis-cli -h localhost -p 6379 ping
```

### Issue: Data missing after upgrade

**Solution:**
```bash
# Check if data directory changed
sudo find /var/lib -name "*.rdb" -o -name "appendonly.aof"

# Restore from backup if needed
sudo systemctl stop redis-server
sudo cp /var/lib/redis.backup/* /var/lib/redis/
sudo chown -R redis:redis /var/lib/redis
sudo systemctl start redis-server
```

## Recommended: Upgrade to Redis 7.x

For best security and performance, consider upgrading to Redis 7.x:

```bash
# Add Redis official repository (see Option 2 above)
# Then install latest
sudo apt install redis

# Verify
redis-cli --version
# Should show: redis-cli 7.x.x
```

## After Upgrade

1. ✅ Remove warning suppression code (optional - warnings won't appear anymore)
2. ✅ Monitor logs for any issues
3. ✅ Test all Redis-dependent features:
   - Caching
   - Job queue
   - Rate limiting
   - Session storage (if used)

## Security Benefits

Upgrading fixes these CVEs:
- CVE-2024-31449: Lua library commands stack overflow
- CVE-2024-31228: Denial-of-service via unbounded pattern matching
- CVE-2023-45145: Unix socket permissions race condition
- CVE-2022-24834: Heap overflow in Lua scripting
- CVE-2023-28856: HINCRBYFLOAT command crash

## Support

- Redis Documentation: https://redis.io/docs/
- Redis Releases: https://github.com/redis/redis/releases
- Security Advisories: https://github.com/redis/redis/security
