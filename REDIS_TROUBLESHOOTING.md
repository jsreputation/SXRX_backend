# Redis Connection Troubleshooting Guide

## Common Redis Errors

If you're seeing errors like:
- `[CACHE] Redis error { "error": "" }`
- `[JOB_QUEUE] Worker error in queue { "error": "" }`

This indicates Redis connection issues. Follow these steps to diagnose and fix.

## Step 1: Verify Redis is Running

```bash
# Check if Redis is running
redis-cli ping
# Should return: PONG

# If not running, start Redis:
# Ubuntu/Debian:
sudo systemctl start redis-server

# macOS:
brew services start redis

# Or manually:
redis-server
```

## Step 2: Check Redis Connection Settings

Verify your `.env` file has the correct Redis URL:

```env
REDIS_URL=redis://localhost:6379
# OR with password:
REDIS_URL=redis://:password@localhost:6379
# OR with username and password:
REDIS_URL=redis://username:password@localhost:6379
```

**Common Issues:**
- Missing `REDIS_URL` - defaults to `redis://localhost:6379`
- Wrong host/port
- Password mismatch
- Redis not accessible from backend server

## Step 3: Test Redis Connection Manually

```bash
# Test from command line
redis-cli -h localhost -p 6379 ping
# Should return: PONG

# If password is required:
redis-cli -h localhost -p 6379 -a yourpassword ping
```

## Step 4: Check Backend Logs

After fixing error handling, you should now see detailed error messages:

```bash
# View PM2 logs
pm2 logs sxrx-backend --err

# Look for:
# - Connection refused (ECONNREFUSED)
# - Timeout errors
# - Authentication errors
# - Network errors
```

## Step 5: Common Solutions

### Issue: Connection Refused (ECONNREFUSED)

**Cause:** Redis is not running or not accessible

**Solution:**
1. Start Redis: `sudo systemctl start redis-server` (Linux) or `brew services start redis` (macOS)
2. Check Redis is listening: `netstat -tlnp | grep 6379` or `lsof -i :6379`
3. Check firewall rules if Redis is on a different server

### Issue: Authentication Failed

**Cause:** Wrong password or Redis requires authentication

**Solution:**
1. Check Redis password in `redis.conf`
2. Update `REDIS_URL` in `.env` to include password:
   ```env
   REDIS_URL=redis://:yourpassword@localhost:6379
   ```
3. Test connection: `redis-cli -a yourpassword ping`

### Issue: Timeout Errors

**Cause:** Redis is slow to respond or network issues

**Solution:**
1. Check Redis server load: `redis-cli INFO stats`
2. Check network latency
3. Increase timeout in Redis config if needed

### Issue: Redis Not Enabled

**Cause:** `REDIS_ENABLED=false` in environment

**Solution:**
1. Set `REDIS_ENABLED=true` in `.env` (or remove it, as `true` is default)
2. Restart backend: `pm2 restart sxrx-backend`

## Step 6: Disable Redis (If Not Available)

If Redis is not available and you want to continue without it:

```env
REDIS_ENABLED=false
```

**Note:** This will:
- Disable caching (slower performance)
- Disable job queue (jobs execute immediately)
- Disable distributed rate limiting

The application will continue to function, but with reduced performance.

## Step 7: Verify Fix

After fixing the issue:

1. **Restart backend:**
   ```bash
   pm2 restart sxrx-backend
   ```

2. **Check logs for success messages:**
   ```bash
   pm2 logs sxrx-backend | grep -i redis
   ```
   
   Should see:
   - `[CACHE] Redis connected`
   - `[CACHE] Redis ready`
   - `[JOB_QUEUE] Redis connection test successful`

3. **Test health endpoint:**
   ```bash
   curl http://localhost:5000/health
   ```
   
   Should show `"redis": "connected"` in response

## Debugging Commands

```bash
# Check Redis status
redis-cli INFO server

# Check Redis connections
redis-cli CLIENT LIST

# Monitor Redis commands in real-time
redis-cli MONITOR

# Check backend Redis connection from Node.js
node -e "const redis = require('redis'); const client = redis.createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' }); client.connect().then(() => { console.log('Connected!'); client.quit(); }).catch(err => console.error('Error:', err.message));"
```

## Production Checklist

- [ ] Redis is running and accessible
- [ ] `REDIS_URL` is correctly configured
- [ ] Redis password is set (if required)
- [ ] Redis is accessible from backend server (check firewall)
- [ ] Redis persistence is configured (for production)
- [ ] Redis memory limits are set appropriately
- [ ] Redis monitoring is set up
- [ ] Backend logs show successful Redis connection

## Additional Resources

- [Redis Documentation](https://redis.io/docs/)
- [BullMQ Connection Guide](https://docs.bullmq.io/guide/connections)
- [Node Redis Client](https://github.com/redis/node-redis)
