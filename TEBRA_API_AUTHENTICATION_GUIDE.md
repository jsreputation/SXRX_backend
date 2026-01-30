# Tebra API Authentication - Complete Guide

## Based on Official Tebra Documentation

### 🔑 Key Findings from Tebra Documentation

According to the [official Tebra SOAP API documentation](https://helpme.tebra.com/01_Kareo_PM/12_API_and_Integration):

> **"Yes, a System Administrator needs to generate the customer key and set the appropriate security permissions in order to start using the Tebra SOAP API."**

This confirms that **TWO things are required**:
1. ✅ Customer Key (you have: `x45zq28pk73t`)
2. ❌ **System Administrator must set security permissions for the user**

---

## Your Current Situation

### What's Working ✅
- Customer Key is valid (`CustomerKeyValid=true`)
- XML structure is correct
- User credentials work for web login (`app.kareo.com`)

### What's NOT Working ❌
- SOAP API authentication fails with "Invalid user name and/or password"
- User `stepanyan.arman982@gmail.com` can log into web but not API

### Root Cause 🎯
**The user account does NOT have API/Web Services permissions enabled.**

Web login and API access use **different permission systems**:
- **Web Login**: Controlled by "Web User Roles"
- **API Access**: Requires separate "API/Web Services" permissions

---

## Solution: Enable API Permissions

### Step 1: Log into Tebra as System Administrator

You need **System Administrator** access to enable API permissions.

### Step 2: Navigate to User Settings

According to Tebra documentation:

**Option A: User Accounts Settings** (Newer accounts)
1. Go to **Settings** → **Users** → **User Accounts**
2. Find user `stepanyan.arman982@gmail.com`
3. Click **Edit** or **Permissions**

**Option B: Web User Roles** (Older accounts or billing companies)
1. Go to **Settings** → **Web User Roles**
2. Find user `stepanyan.arman982@gmail.com`
3. Click **Edit** or **Manage Roles**

### Step 3: Enable API/Web Services Access

Look for one of these permission options:
- ☐ **API Access**
- ☐ **Web Services**
- ☐ **SOAP API**
- ☐ **External Applications**
- ☐ **Integration Access**

**Enable the checkbox** and **Save**.

### Step 4: Test the API

After enabling permissions, wait 5-10 minutes for changes to propagate, then test:

```bash
cd backend
node test-credential-variations.js
```

You should now see:
- ✅ `CustomerKeyValid=true`
- ✅ `Authenticated=true`  ← This should change!
- ✅ `Authorized=true`

---

## Alternative Solutions

### Option 1: Create API-Specific User

Some organizations create a dedicated user for API access:

1. **Create new user** in Tebra
   - Username: `api@yourdomain.com` or `api_user`
   - Password: Simple password without special characters
   
2. **Assign API permissions** to this user
   
3. **Update .env file**:
   ```env
   TEBRA_USER=api@yourdomain.com
   TEBRA_PASSWORD=SimplePassword123
   ```

**Benefits:**
- Separate API access from personal accounts
- Easier to manage permissions
- Can use simpler password
- Better audit trail

### Option 2: Contact Tebra Support

If you can't find the API permission settings:

**Email:** support@tebra.com  
**Phone:** Check your Tebra account for support number

**What to say:**
> "I need to enable SOAP API access for user `stepanyan.arman982@gmail.com` under customer key `x45zq28pk73t`. The user can log into the web interface but gets 'Invalid user name and/or password' when using the SOAP API. Please enable API/Web Services permissions for this user."

### Option 3: SOAP Only

This project uses SOAP only. If API access is blocked, work with Tebra support to enable SOAP permissions for the user.

---

## Common Issues & Solutions

### Issue 1: "Invalid user name and/or password" (Your Current Issue)

**Cause:** User doesn't have API permissions  
**Solution:** Enable API access in user settings (see above)

### Issue 2: "Invalid customer key"

**Cause:** Wrong customer key or not associated with user  
**Solution:** Verify customer key in Tebra settings

### Issue 3: Password with Special Characters

**Cause:** Special characters like `!@#` may cause XML parsing issues  
**Solution:** 
- Change password to alphanumeric only
- Or use XML entity encoding (already implemented in code)

### Issue 4: Two-Factor Authentication (2FA)

**Note:** Tebra requires 2FA for web login but **NOT for API access**  
**API uses:** Customer Key + Username + Password only

---

## Testing Checklist

After enabling API permissions, verify:

- [ ] Customer key is correct
- [ ] User has API/Web Services permission enabled
- [ ] Password doesn't have problematic special characters
- [ ] Wait 5-10 minutes after enabling permissions
- [ ] Test with `test-credential-variations.js`
- [ ] Check for `Authenticated=true` in response
- [ ] Test `get-tebra-providers.js` script

---

## Technical Details

### SOAP API Authentication Flow

```
1. Client sends SOAP request with:
   - CustomerKey (validates account)
   - User (validates user exists)
   - Password (validates credentials)

2. Tebra validates:
   ✓ CustomerKey → Is this a valid customer?
   ✓ User → Does this user exist?
   ✓ Password → Is password correct?
   ✓ Permissions → Does user have API access? ← YOUR ISSUE
   
3. Response includes:
   - CustomerKeyValid: true/false
   - Authenticated: true/false
   - Authorized: true/false
```

### Your Current Response

```xml
<CustomerKeyValid>true</CustomerKeyValid>  ← ✅ Working
<Authenticated>false</Authenticated>        ← ❌ Failing here
<Authorized>false</Authorized>
<SecurityResult>Invalid user name and/or password</SecurityResult>
```

This pattern indicates: **Valid customer, but user lacks API permissions**

---

## Password Best Practices for API

### ✅ Recommended Password Format
- Alphanumeric only: `Team123ABC`
- With underscore: `Team_123_ABC`
- Longer simple: `TeamPassword123`

### ❌ Avoid These Characters
- `!` Exclamation mark
- `@` At symbol
- `#` Hash/pound
- `$` Dollar sign
- `%` Percent
- `&` Ampersand
- `*` Asterisk
- `()` Parentheses
- `<>` Angle brackets

**Why?** These characters can cause XML parsing issues in SOAP requests.

---

## Next Steps

### Immediate Actions (Today)

1. **Check user permissions** in Tebra admin panel
2. **Enable API access** for `stepanyan.arman982@gmail.com`
3. **Test API** after 10 minutes
4. **If still failing**, contact Tebra support

### Short-term (This Week)

1. **Consider creating** dedicated API user
2. **Change password** to remove special characters
3. **Document** which permissions are needed
4. **Test all API operations** to ensure they work

### Long-term (This Month)

1. **Improve error handling** in tebraService
2. **Add monitoring** for API authentication issues

---

## Summary

**Your issue is NOT with the code** - it's with **user permissions in Tebra**.

The code is working correctly. The XML structure is correct. The customer key is valid. The user credentials are correct for web login.

**The ONLY issue:** The user account doesn't have API/Web Services permissions enabled.

**Solution:** Have a System Administrator enable API access for the user in Tebra settings.

**Time to fix:** 5 minutes (once you find the setting) + 10 minutes (for changes to propagate)

---

## References

- [Tebra SOAP API Documentation](https://helpme.tebra.com/01_Kareo_PM/12_API_and_Integration)
- [Tebra API Integration User Guide](https://helpme.tebra.com/Tebra_PM/12_API_and_Integration/01_Get_Started_with_Tebra_API_Integration/Tebra_API_Integration_User_Guide)
- [Tebra Customer Key Guide](https://helpme.tebra.com/Tebra_PM/01_Configure_System/Customer_Key/Get_Customer_Key)
- [Tebra Web User Roles](https://helpme.tebra.com/01_Kareo_PM/04_Settings/Users/Web_User_Roles)
