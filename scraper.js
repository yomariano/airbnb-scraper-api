const puppeteer = require('puppeteer');
const puppeteerCore = require('puppeteer-core');

/**
 * Validate if the URL is a valid Airbnb listing URL
 */
const validateAirbnbUrl = (url) => {
  try {
    const urlObj = new URL(url);
    const airbnbDomainPattern = /^(www\.)?airbnb\.(com|co\.[a-z]{2}|[a-z]{2,3})$/i;
    return airbnbDomainPattern.test(urlObj.hostname);
  } catch (error) {
    return false;
  }
};

/**
 * Get current proxy configuration
 */
const getProxyConfig = () => {
  const useProxy = process.env.USE_PROXY === 'true';
  const useBrightDataBrowser = process.env.USE_BRIGHTDATA_BROWSER === 'true';

  if (useBrightDataBrowser) {
    return {
      enabled: true,
      type: 'BrightData Scraping Browser',
      host: `${process.env.PROXY_HOST}:${process.env.PROXY_PORT}`
    };
  } else if (useProxy) {
    return {
      enabled: true,
      type: 'HTTP Proxy',
      host: `${process.env.PROXY_HOST}:${process.env.PROXY_PORT}`
    };
  }

  return {
    enabled: false,
    type: 'Direct Connection',
    host: null
  };
};

/**
 * Connect to browser based on configuration
 */
const connectBrowser = async () => {
  const useBrightDataBrowser = process.env.USE_BRIGHTDATA_BROWSER === 'true';
  const useProxy = process.env.USE_PROXY === 'true';
  const proxyHost = process.env.PROXY_HOST || 'brd.superproxy.io';
  const proxyPort = process.env.PROXY_PORT || '9222';
  const proxyUsername = process.env.PROXY_USERNAME;
  const proxyPassword = process.env.PROXY_PASSWORD;

  let browser;

  if (useBrightDataBrowser) {
    // Use BrightData Scraping Browser via WebSocket
    const browserWSEndpoint = `wss://${proxyUsername}:${proxyPassword}@${proxyHost}:${proxyPort}`;
    console.log('Connecting to BrightData Scraping Browser...');

    try {
      browser = await puppeteerCore.connect({
        browserWSEndpoint,
        defaultViewport: null
      });
      console.log('Connected to BrightData successfully');
    } catch (error) {
      console.log('BrightData connection failed, using direct connection');
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: null
      });
    }
  } else {
    // Regular launch with or without proxy
    const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox'];

    if (useProxy) {
      launchArgs.push(`--proxy-server=${proxyHost}:${proxyPort}`);
      console.log(`Using HTTP proxy: ${proxyHost}:${proxyPort}`);
    }

    browser = await puppeteer.launch({
      headless: 'new',
      args: launchArgs,
      defaultViewport: null
    });
  }

  return { browser, useBrightDataBrowser, useProxy, proxyUsername, proxyPassword };
};

/**
 * Extract images from the page
 */
const extractImages = async (page) => {
  return await page.evaluate(() => {
    const allImages = [];
    const seenUrls = new Set();

    // Extract from img tags
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

    // Extract from picture elements
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

    // Extract from background images
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
};

/**
 * Extract title from the page
 */
const extractTitle = async (page) => {
  return await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    if (h1) return h1.textContent.trim();

    const titleSection = document.querySelector('[data-section-id="TITLE_DEFAULT"] h2');
    if (titleSection) return titleSection.textContent.trim();

    const metaTitle = document.querySelector('meta[property="og:title"]');
    if (metaTitle) return metaTitle.content;

    return document.title.split('·')[0].trim();
  });
};

/**
 * Main scraping function
 */
const scrapeAirbnbListing = async (url, useProxyOverride) => {
  // Override proxy setting if specified
  if (typeof useProxyOverride === 'boolean') {
    process.env.USE_PROXY = useProxyOverride.toString();
    process.env.USE_BRIGHTDATA_BROWSER = useProxyOverride.toString();
  }

  const { browser, useBrightDataBrowser, useProxy, proxyUsername, proxyPassword } = await connectBrowser();

  try {
    const page = await browser.newPage();

    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    // Authenticate with proxy if needed
    if (useProxy && !useBrightDataBrowser && proxyUsername && proxyPassword) {
      await page.authenticate({
        username: proxyUsername,
        password: proxyPassword
      });
    }

    // Navigate to the page
    const timeout = useBrightDataBrowser ? 2 * 60 * 1000 : 30000;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });

    // Wait for images to load
    await page.waitForSelector('img', { timeout: 15000 });
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Scroll to load more images
    await page.evaluate(() => {
      window.scrollBy(0, 500);
    });
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Extract data
    const images = await extractImages(page);
    const title = await extractTitle(page);

    await browser.close();

    return {
      url,
      proxyUsed: useProxy || useBrightDataBrowser,
      data: {
        title,
        totalImages: images.length,
        gallery: images.slice(0, 50)
      }
    };

  } catch (error) {
    await browser.close();
    throw error;
  }
};

module.exports = {
  validateAirbnbUrl,
  getProxyConfig,
  scrapeAirbnbListing
};