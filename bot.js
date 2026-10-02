const { chromium } = require('playwright');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sanitizeSameSite(val) {
  if (!val) return 'Lax';
  const s = String(val).toLowerCase();
  if (s.includes('lax')) return 'Lax';
  if (s.includes('strict')) return 'Strict';
  if (s.includes('none') || s.includes('no_restriction')) return 'None';
  return 'Lax';
}

(async () => {
  const target = process.env.TARGET_USER;
  if (!target) {
    console.error('[-] Error: Variabel environment TARGET_USER tidak ditemukan!');
    process.exit(1);
  }

  let rawCookies = [];
  try {
    rawCookies = JSON.parse(process.env.TIKTOK_COOKIES || '[]');
  } catch (err) {
    console.error('[-] Error parsing TIKTOK_COOKIES JSON:', err.message);
    process.exit(1);
  }

  // Format cookie agar mencakup domain .tiktok.com secara menyeluruh
  const formattedCookies = rawCookies.map((c) => {
    let domain = c.domain || '.tiktok.com';
    if (!domain.startsWith('.')) domain = '.' + domain;
    const cookieObj = {
      name: c.name,
      value: c.value,
      domain: domain,
      path: c.path || '/'
    };
    if (c.sameSite) {
      cookieObj.sameSite = sanitizeSameSite(c.sameSite);
    }
    return cookieObj;
  });

  console.log('[*] Menyiapkan browser Chromium...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });

  await context.addCookies(formattedCookies);
  const page = await context.newPage();

  // Memantau respons network khusus aksi follow
  let apiFollowResponse = null;
  page.on('response', async (response) => {
    if (response.url().includes('/api/commit/follow/user/')) {
      try {
        const resJson = await response.json();
        apiFollowResponse = resJson;
        console.log('[*] Respon Server TikTok:', JSON.stringify(resJson));
      } catch (_) {}
    }
  });

  const cleanTarget = target.trim().replace('@', '');
  console.log(`[*] Mengunjungi profil target: https://www.tiktok.com/@${cleanTarget}`);

  try {
    await page.goto(`https://www.tiktok.com/@${cleanTarget}`, {
      waitUntil: 'domcontentloaded',
      timeout: 35000
    });

    await sleep(4000);

    // 1. Cek apakah sesi login benar-benar aktif (periksa apakah ada avatar profil sendiri)
    const isLoggedIn = await page.locator('[data-e2e="profile-icon"]').count() > 0;
    if (isLoggedIn) {
      console.log('[+] Status: Sesi login terverifikasi aktif!');
    } else {
      console.log('[-] PERINGATAN: Sesi login TIDAK terdeteksi! Browser dianggap sebagai tamu (guest).');
    }

    // 2. Tutup popup overlay jika ada
    try {
      await page.keyboard.press('Escape');
      const closeBtn = page.locator('[data-e2e="modal-close-icon"], button[aria-label="Close"]').first();
      if (await closeBtn.isVisible()) {
        await closeBtn.click({ force: true });
        await sleep(1000);
      }
    } catch (_) {}

    // 3. Cari tombol follow profil utama
    let followBtn = page.locator(`button[data-e2e="follow-button"][aria-label*="${cleanTarget}" i]`).first();
    if (await followBtn.count() === 0) {
      followBtn = page.locator('[data-e2e="user-page"] button[data-e2e="follow-button"]').first();
    }
    if (await followBtn.count() === 0) {
      followBtn = page.locator('button[data-e2e="follow-button"]').first();
    }

    await followBtn.waitFor({ state: 'attached', timeout: 15000 });
    const btnText = (await followBtn.innerText()).toLowerCase();

    if (btnText.includes('following') || btnText.includes('mengikuti')) {
      console.log(`[!] Info: Akun @${cleanTarget} sudah di-follow sebelumnya.`);
    } else {
      await followBtn.scrollIntoViewIfNeeded();
      await sleep(1500);
      await followBtn.click({ force: true });
      console.log(`[+] Tombol follow ditekan! Menunggu respon server TikTok...`);

      // Tunggu respons network
      await sleep(5000);

      // Cek apakah muncul pop-up login setelah tombol ditekan
      const loginModal = page.locator('#loginContainer, [data-e2e="login-modal"]');
      if (await loginModal.count() > 0 && await loginModal.isVisible()) {
        console.log('[-] GAGAL: Muncul dialog permintaan login! Cookie tidak valid atau expired.');
      }

      // Cek apakah muncul Captcha
      const captcha = page.locator('#captcha-verify-image, .captcha_verify_container');
      if (await captcha.count() > 0 && await captcha.isVisible()) {
        console.log('[-] GAGAL: Muncul verifikasi puzzle/captcha!');
      }

      if (apiFollowResponse) {
        if (apiFollowResponse.status_code === 0) {
          console.log('[+] SUKSES BESAR: Server mengonfirmasi follow berhasil masuk ke database!');
        } else {
          console.log(`[-] GAGAL DARI SERVER: status_code ${apiFollowResponse.status_code} (${apiFollowResponse.status_msg})`);
        }
      } else {
        console.log('[-] Tidak ada sinyal network follow yang terkirim ke server.');
      }
    }
  } catch (err) {
    console.error(`[-] Terjadi error:`, err.message);
  } finally {
    await browser.close();
    console.log('[*] Selesai.');
  }
})();
