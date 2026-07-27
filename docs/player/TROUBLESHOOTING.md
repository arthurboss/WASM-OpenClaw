# Troubleshooting Guide

## Clear IndexedDB Storage

If you need to re-upload CLAW.REZ or encounter storage issues, you can clear the cached data:

### Method 1: Using Browser DevTools (Recommended)

**Chrome / Edge:**

1. Press `F12` to open DevTools
2. Go to **Application** tab
3. Expand **IndexedDB** in the left sidebar
4. Right-click on **ClawWebAssets**
5. Select **Delete database**
6. Refresh the page - you'll be prompted to upload CLAW.REZ again

**Firefox:**

1. Press `F12` to open DevTools
2. Go to **Storage** tab
3. Expand **IndexedDB** in the left sidebar
4. Right-click on **ClawWebAssets**
5. Select **Delete "ClawWebAssets"**
6. Refresh the page - you'll be prompted to upload CLAW.REZ again

**Safari:**

1. Press `Option + Command + C` to open Web Inspector
2. Go to **Storage** tab
3. Select **IndexedDB** → **ClawWebAssets**
4. Click the trash icon to delete
5. Refresh the page - you'll be prompted to upload CLAW.REZ again

### Method 2: Using Browser Console

1. Press `F12` to open DevTools
2. Go to **Console** tab
3. Paste this command and press Enter:

   ```javascript
   indexedDB.deleteDatabase('ClawWebAssets')
   ```

4. Refresh the page - you'll be prompted to upload CLAW.REZ again

### Method 3: Using In-Game Function

If the game loads but you want to re-upload:

1. Open browser console (`F12` → Console tab)
2. Run:

   ```javascript
   reuploadClawRez()
   ```

3. Follow the prompts to delete and re-upload

## Common Issues

### "Upload failed" Error

**Causes:**

- File not named exactly `CLAW.REZ` (case-insensitive)
- File size incorrect (~113 MB expected)
- Browser storage quota exceeded
- Compression failed during upload

**Solutions:**

1. Verify file name is exactly `CLAW.REZ`
2. Check file size is approximately 113 MB
3. Clear browser storage (see above)
4. Try a different browser

### "Out of storage" Error

**Causes:**

- Browser storage quota too low
- Too many cached websites using storage

**Note:** CLAW.REZ requires ~113MB of IndexedDB storage.

**Solutions:**

1. Clear storage for other websites:
   - **Chrome/Edge:** Settings → Privacy and security → Site Settings → View permissions and data stored
   - **Firefox:** Settings → Privacy & Security → Cookies and Site Data → Manage Data
   - **Safari:** Preferences → Websites → Website Data → Remove
2. Increase storage quota (Chrome):
   - Go to `chrome://settings/content/all`
   - Find your site and adjust storage limit
3. Try a different browser

### "CLAW.REZ not found" After Upload

**Causes:**

- IndexedDB not enabled
- Browser in private/incognito mode (storage not persistent)
- Browser extension blocking storage

**Solutions:**

1. Check IndexedDB is enabled:
   - **Chrome/Edge:** `chrome://settings/content/all` → IndexedDB
   - **Firefox:** `about:config` → search `dom.indexedDB.enabled` → set to `true`
2. Exit private/incognito mode
3. Disable browser extensions temporarily
4. Clear IndexedDB and try again (see above)

### Game Loads Slowly

**Causes:**

- Large CLAW.REZ file loading from IndexedDB
- Slow system/browser
- Many browser tabs open

**Solutions:**

1. Close unnecessary browser tabs to free up memory
2. Subsequent loads should be a few seconds total

### Assets Won't Load

**Causes:**

- Corrupted IndexedDB storage
- Incomplete CLAW.REZ upload
- Browser cache issues

**Solutions:**

1. Open browser console (`F12`) and check for errors
2. Clear IndexedDB (see Method 1 above)
3. Re-upload CLAW.REZ
4. Clear browser cache:
   - **Chrome/Edge:** `Ctrl+Shift+Delete` → Clear cached images and files
   - **Firefox:** `Ctrl+Shift+Delete` → Cache
   - **Safari:** Develop → Empty Caches

### "WebGL context lost" Error

**Causes:**

- GPU driver crash
- Browser tab suspended by system
- Too many GPU-intensive tabs open

**Solutions:**

1. Reload the page (CLAW.REZ remains cached)
2. Update graphics drivers
3. Close other GPU-intensive applications/tabs
4. Enable hardware acceleration:
   - **Chrome/Edge:** Settings → System → Use hardware acceleration
   - **Firefox:** Settings → Performance → Use hardware acceleration

## Check Storage Usage

To see how much storage the game is using:

1. Open browser console (`F12` → Console)
2. Run:

   ```javascript
   getStorageStats().then(stats => {
     console.log('Files:', stats.files)
     console.log('Total Size:', stats.totalSizeMB + ' MB')
   })
   ```

Expected output:

```
Files: ["CLAW.REZ"]
Total Size: 113.00 MB
```

## Browser Storage Limits

Different browsers have different storage limits:

- **Chrome/Edge:** ~60% of available disk space (shared across all sites)
- **Firefox:** ~50% of available disk space (shared across all sites)
- **Safari:** ~1 GB per origin initially, can request more

If you're running low on disk space, the game may fail to store CLAW.REZ.

## Still Having Issues?

1. Check browser console (`F12` → Console) for error messages
2. Try a different browser (Chrome recommended)
3. Ensure browser is up to date
4. Disable browser extensions temporarily
5. Report issues at: <https://github.com/arthurboss/OpenClaw/issues>

Include in your report:

- Browser name and version
- Operating system
- Console error messages (screenshot or copy-paste)
- Steps to reproduce the problem
