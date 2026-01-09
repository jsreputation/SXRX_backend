#!/bin/bash

# Quick fix script for TebraService import error
# Run this on the server after uploading the fixed file

echo "🔧 Fixing TebraService import error..."

cd /var/www/sxrx-backend/src/services

# Backup original file
if [ ! -f tebraServiceSingleton.js.bak ]; then
    cp tebraServiceSingleton.js tebraServiceSingleton.js.bak
    echo "✅ Backup created: tebraServiceSingleton.js.bak"
fi

# Fix the import line
sed -i "s/const TebraService = require('\.\/tebraService');/const { TebraService } = require('\.\/tebraService');/" tebraServiceSingleton.js

echo "✅ File updated!"

# Verify the change
if grep -q "const { TebraService }" tebraServiceSingleton.js; then
    echo "✅ Fix verified - import is correct"
else
    echo "❌ Fix failed - please check manually"
    exit 1
fi

echo ""
echo "🔄 Restarting PM2..."
pm2 restart sxrx-backend

echo ""
echo "✅ Done! Check logs with: pm2 logs sxrx-backend"

