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

  const formattedCookies = rawCookies.map((c) => {
    const cookieObj = {
      name: c.name,
      value: c.value,
      domain: c.domain.startsWith('.') ? c.domain : `.${c.domain}`,
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

  const cleanTarget = target.trim().replace('@', '');
  console.log(`[*] Mengunjungi profil target: https://www.tiktok.com/@${cleanTarget}`);

  try {
    await page.goto(`https://www.tiktok.com/@${cleanTarget}`, {
      waitUntil: 'domcontentloaded',
      timeout: 35000
    });

    await sleep(5000);

    // 1. Coba tutup popup/modal jika ada yang muncul di layar
    try {
      await page.keyboard.press('Escape');
      // Klik tombol close/silang modal jika ada
      const modalCloseBtn = page.locator('[data-e2e="modal-close-icon"], button[aria-label="Close"], .TUXModal-close').first();
      if (await modalCloseBtn.isVisible()) {
        await modalCloseBtn.click({ force: true });
        await sleep(1000);
      }
    } catch (_) {}

    // 2. Strategi Seleksi Tombol Follow Target
    // Opsi A: Berdasarkan aria-label target langsung
    let followBtn = page.locator(`button[data-e2e="follow-button"][aria-label*="${cleanTarget}" i]`).first();

    // Opsi B: Cari tombol follow yang ada di kontainer profil bagian atas (bukan suggested accounts)
    if (await followBtn.count() === 0) {
      followBtn = page.locator('[data-e2e="user-page"] button[data-e2e="follow-button"]').first();
    }

    // Opsi C: Fallback umum jika container tidak memiliki data-e2e khusus
    if (await followBtn.count() === 0) {
      followBtn = page.locator('button[data-e2e="follow-button"]').first();
    }

    await followBtn.waitFor({ state: 'attached', timeout: 15000 });

    const btnText = (await followBtn.innerText()).toLowerCase();

    if (btnText.includes('following') || btnText.includes('mengikuti') || btnText.includes('teman') || btnText.includes('friends')) {
      console.log(`[!] Info: Akun @${cleanTarget} sudah di-follow sebelumnya.`);
    } else {
      await followBtn.scrollIntoViewIfNeeded();
      await sleep(1000);
      await followBtn.click({ force: true });
      console.log(`[+] SUKSES: Berhasil menekan tombol follow untuk @${cleanTarget}!`);

      // Tunggu respons server selesai
      await sleep(6000);
    }
  } catch (err) {
    console.error(`[-] Gagal mengeksekusi follow pada @${cleanTarget}:`, err.message);
    process.exit(1);
  } finally {
    await browser.close();
    console.log('[*] Selesai.');
  }
})();
