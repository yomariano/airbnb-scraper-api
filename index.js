require('dotenv').config();
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const puppeteerCore = require('puppeteer-core');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const validateAirbnbUrl = (url) => {
  try {
    const urlObj = new URL(url);
    const airbnbDomainPattern = /^(www\.)?airbnb\.(com|co\.[a-z]{2}|[a-z]{2,3})$/i;
    return airbnbDomainPattern.test(urlObj.hostname);
  } catch (error) {
    return false;
  }
};

const extractGalleryImages = async (url) => {
  // Proxy configuration from environment variables
  const useProxy = process.env.USE_PROXY === 'true';
  const useBrightDataBrowser = process.env.USE_BRIGHTDATA_BROWSER === 'true';
  const proxyHost = process.env.PROXY_HOST || 'brd.superproxy.io';
  const proxyPort = process.env.PROXY_PORT || '9222';
  const proxyUsername = process.env.PROXY_USERNAME || 'brd-customer-hl_356602a2-zone-scraping_browser1';
  const proxyPassword = process.env.PROXY_PASSWORD || '713k00vtlyvt';

  let browser;

  if (useBrightDataBrowser) {
    // Use BrightData Scraping Browser via WebSocket
    const browserWSEndpoint = `wss://${proxyUsername}:${proxyPassword}@${proxyHost}:${proxyPort}`;
    console.log(`Connecting to BrightData Scraping Browser...`);

    try {
      browser = await puppeteerCore.connect({
        browserWSEndpoint,
        defaultViewport: null
      });
      console.log('Connected to BrightData Scraping Browser successfully');
    } catch (error) {
      console.log('BrightData Browser connection failed:', error.message);
      console.log('Falling back to direct connection...');
      // Fallback to direct connection
      browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled'
        ],
        defaultViewport: null
      });
    }
  } else {
    // Regular launch with or without proxy
    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ];

    if (useProxy) {
      launchArgs.push(`--proxy-server=${proxyHost}:${proxyPort}`);
      console.log(`Using proxy: ${proxyHost}:${proxyPort}`);
    }

    browser = await puppeteer.launch({
      headless: 'new',
      args: launchArgs,
      defaultViewport: null
    });
  }

  try {
    const page = await browser.newPage();

    // Authenticate with proxy if using regular proxy (not BrightData Browser)
    if (useProxy && !useBrightDataBrowser) {
      await page.authenticate({
        username: proxyUsername,
        password: proxyPassword
      });
    }

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    // Use longer timeout for BrightData Browser
    const timeout = useBrightDataBrowser ? 2 * 60 * 1000 : 30000;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });

    await page.waitForSelector('img', {
      timeout: 15000
    });

    await new Promise(resolve => setTimeout(resolve, 5000));

    await page.evaluate(() => {
      window.scrollBy(0, 500);
    });
    await new Promise(resolve => setTimeout(resolve, 2000));

    const images = await page.evaluate(() => {
      const allImages = [];
      const seenUrls = new Set();

      document.querySelectorAll('img').forEach(img => {
        if (img.src && img.src.includes('muscache.com')) {
          const cleanUrl = img.src.split('?')[0];

          if (!seenUrls.has(cleanUrl) &&
              !cleanUrl.includes('profile') &&
              !cleanUrl.includes('user')) {

            seenUrls.add(cleanUrl);
            allImages.push({
              url: cleanUrl + '?im_w=1200',
              alt: img.alt || '',
              width: img.naturalWidth || img.width || null,
              height: img.naturalHeight || img.height || null
            });
          }
        }
      });

      document.querySelectorAll('picture img').forEach(img => {
        const src = img.currentSrc || img.src;
        if (src && src.includes('muscache.com')) {
          const cleanUrl = src.split('?')[0];

          if (!seenUrls.has(cleanUrl) &&
              !cleanUrl.includes('profile') &&
              !cleanUrl.includes('user')) {

            seenUrls.add(cleanUrl);
            allImages.push({
              url: cleanUrl + '?im_w=1200',
              alt: img.alt || '',
              width: img.naturalWidth || img.width || null,
              height: img.naturalHeight || img.height || null
            });
          }
        }
      });

      document.querySelectorAll('[style*="background-image"]').forEach(elem => {
        const style = elem.getAttribute('style');
        const matches = style.match(/url\(["']?(https:\/\/[^"')]+muscache\.com[^"')]+)/);
        if (matches && matches[1]) {
          const cleanUrl = matches[1].split('?')[0];

          if (!seenUrls.has(cleanUrl) &&
              !cleanUrl.includes('profile') &&
              !cleanUrl.includes('user')) {

            seenUrls.add(cleanUrl);
            allImages.push({
              url: cleanUrl + '?im_w=1200',
              alt: '',
              width: null,
              height: null
            });
          }
        }
      });

      return allImages;
    });

    const title = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      if (h1) return h1.textContent.trim();

      const titleSection = document.querySelector('[data-section-id="TITLE_DEFAULT"] h2');
      if (titleSection) return titleSection.textContent.trim();

      const metaTitle = document.querySelector('meta[property="og:title"]');
      if (metaTitle) return metaTitle.content;

      return document.title.split('·')[0].trim();
    });

    await browser.close();

    return {
      title,
      images: images.slice(0, 50),
      totalImages: images.length
    };

  } catch (error) {
    await browser.close();
    throw error;
  }
};

app.post('/scrape', async (req, res) => {
  const { url, useProxy } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL is required'
    });
  }

  if (!validateAirbnbUrl(url)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid Airbnb URL. Please provide a valid Airbnb listing URL.'
    });
  }

  try {
    // Override proxy setting if specified in request
    if (typeof useProxy === 'boolean') {
      process.env.USE_PROXY = useProxy.toString();
    }

    const proxyEnabled = process.env.USE_PROXY === 'true';
    console.log(`Scraping: ${url} (Proxy: ${proxyEnabled ? 'enabled' : 'disabled'})`);

    const data = await extractGalleryImages(url);

    res.json({
      success: true,
      url,
      proxyUsed: proxyEnabled,
      data: {
        title: data.title,
        totalImages: data.totalImages,
        gallery: data.images
      }
    });

  } catch (error) {
    console.error('Scraping error:', error);

    // If proxy fails, suggest trying without proxy
    const proxyEnabled = process.env.USE_PROXY === 'true';
    const errorResponse = {
      success: false,
      error: 'Failed to scrape the Airbnb listing',
      message: error.message
    };

    if (proxyEnabled && error.message.includes('ERR_')) {
      errorResponse.suggestion = 'Proxy connection failed. Try setting useProxy to false in the request body.';
    }

    res.status(500).json(errorResponse);
  }
});

app.get('/health', (req, res) => {
  const useProxy = process.env.USE_PROXY === 'true';
  res.json({
    status: 'OK',
    message: 'Airbnb Scraper API is running',
    proxy: {
      enabled: useProxy,
      host: useProxy ? `${process.env.PROXY_HOST}:${process.env.PROXY_PORT}` : null,
      type: useProxy ? 'BrightData' : 'Direct connection'
    }
  });
});

app.listen(PORT, () => {
  console.log(`Airbnb Scraper API is running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`POST endpoint: http://localhost:${PORT}/scrape`);
});