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
  // Choose sensible defaults: 9222 for BD Scraping Browser (WebSocket), 22225 for HTTP proxies
  const proxyPort = process.env.PROXY_PORT || (useBrightDataBrowser ? '9222' : (useProxy ? '22225' : '9222'));
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
const scrapeAirbnbListing = async (url, useProxyOverride, maxImagesOverride) => {
  // Override proxy setting if specified
  if (typeof useProxyOverride === 'boolean') {
    // Only override the HTTP proxy flag. Do not toggle BrightData Scraping Browser here.
    process.env.USE_PROXY = useProxyOverride.toString();
  }

  const { browser, useBrightDataBrowser, useProxy, proxyUsername, proxyPassword } = await connectBrowser();

  try {
    const page = await browser.newPage();

    // Block accidental navigations to restricted endpoints (e.g., contact_host)
    try {
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const requestUrl = request.url();
        const isTopNav = request.isNavigationRequest();
        if (isTopNav && /\/contact_host\//.test(requestUrl)) {
          return request.abort();
        }
        return request.continue();
      });
    } catch (e) {
      // Non-fatal: interception may not be supported in some contexts
    }

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
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Try to click "Show all photos" button if it exists
    try {
      // First, try to find and click the explicit photo gallery trigger(s)
      const photoButtonClicked = await page.evaluate(() => {
        const isPhotoTrigger = (el) => {
          if (!el) return false;
          const text = (el.textContent || '').toLowerCase();
          const aria = (el.getAttribute('aria-label') || '').toLowerCase();
          const href = (el.getAttribute('href') || '').toLowerCase();

          // Exclude known non-gallery targets
          if (href.includes('/contact_host/')) return false;

          // Prefer obvious photo/gallery cues
          const hasPhotoWords = /photos?|pictures?|fotos?/.test(text) || /photos?/.test(aria);
          const isPhotosLink = href.includes('/photos');
          return hasPhotoWords || isPhotosLink;
        };

        // Strategy 1: explicit buttons with aria-label/text mentioning photos
        const explicitSelectors = [
          'button[aria-label*="photo" i]',
          'button[aria-label*="photos" i]',
          'button[aria-label*="show all" i]',
          '[data-testid*="photo" i]',
          '[data-testid*="photos" i]',
          '[data-testid="photo-viewer-slideshow-desktop"] button',
          'a[href*="/photos"]'
        ];

        for (const sel of explicitSelectors) {
          const el = document.querySelector(sel);
          if (el && isPhotoTrigger(el)) {
            el.click();
            return `selector:${sel}`;
          }
        }

        // Strategy 2: scan all clickable controls and pick one that clearly mentions photos
        const candidates = Array.from(document.querySelectorAll('button, [role="button"], a[href]'))
          .filter(isPhotoTrigger);
        if (candidates.length > 0) {
          candidates[0].click();
          return 'candidate:photos-match';
        }

        // Avoid generic fallbacks that might click unrelated buttons like "Contact host"
        return null;
      });

      if (photoButtonClicked) {
        console.log(`Clicked photo gallery using strategy: ${photoButtonClicked}`);
        // Wait longer for modal to fully load
        await new Promise(resolve => setTimeout(resolve, 4000));
      }

    } catch (error) {
      console.log('Could not click photo gallery button:', error.message);
    }

    // Scroll to load lazy-loaded images in the gallery
    await page.evaluate(async () => {
      const scrollContainer = document.querySelector('[role="dialog"]') ||
                            document.querySelector('.modal-content') ||
                            document.body;

      const scrollStep = 300;
      const scrollDelay = 500;
      let previousHeight = 0;
      let currentHeight = scrollContainer.scrollHeight;

      while (previousHeight !== currentHeight) {
        previousHeight = currentHeight;
        scrollContainer.scrollTop += scrollStep;
        await new Promise(resolve => setTimeout(resolve, scrollDelay));
        currentHeight = scrollContainer.scrollHeight;
      }

      // Scroll back to top to capture any images that might have loaded
      scrollContainer.scrollTop = 0;
      await new Promise(resolve => setTimeout(resolve, 1000));
    });

    // Extract images with categories from the gallery
    const imagesData = await page.evaluate(() => {
      const allImages = [];
      const seenUrls = new Set();
      const categoryMap = new Map(); // Map image URLs to categories

      // Define exterior/outdoor categories to exclude
      const exteriorKeywords = [
        'balcony', 'balcon', 'balcón', 'exterior', 'outdoor', 'outside',
        'patio', 'terrace', 'garden', 'yard', 'pool', 'view from',
        'street', 'building', 'neighbourhood', 'neighborhood',
        'entrance', 'façade', 'facade', 'roof', 'aerial', 'city view'
      ];

      // Helper function to check if category is exterior
      const isExteriorCategory = (text) => {
        if (!text) return false;
        const lowerText = text.toLowerCase();
        return exteriorKeywords.some(keyword => lowerText.includes(keyword));
      };

      // Find the gallery modal
      const modal = document.querySelector('[role="dialog"], [aria-modal="true"]');

      if (modal) {
        console.log('Gallery modal found, extracting images with categories...');

        // Method 1: Look for image containers with visible captions
        const slides = modal.querySelectorAll('[role="group"]');
        slides.forEach((slide, index) => {
          // Find the main image in this slide
          const img = slide.querySelector('img[src*="muscache.com"]:not([src*="profile"]):not([src*="user"])');
          if (!img || !img.src) return;

          // Look for category text - Airbnb shows it on the left side
          let category = '';

          // Check for h3/h4 headings which often contain the category
          const heading = slide.querySelector('h3, h4');
          if (heading) {
            category = heading.textContent?.trim() || '';
          }

          // If no heading, check for any text element that might be a category
          if (!category) {
            // Look for text in the slide that's not the image
            const textElements = slide.querySelectorAll('div');
            for (const elem of textElements) {
              const text = elem.textContent?.trim();
              // Check if it's a short label (categories are usually 2-30 chars)
              if (text && text.length > 1 && text.length < 30 &&
                  !text.includes('of') && !text.includes('/')) {
                category = text;
                break;
              }
            }
          }

          const cleanUrl = img.src.split('?')[0];
          categoryMap.set(cleanUrl, category);
        });

        // Method 2: Get all images and match with categories
        const allModalImages = modal.querySelectorAll('img[src*="muscache.com"]');
        allModalImages.forEach(img => {
          const cleanUrl = img.src.split('?')[0];

          // Skip duplicates, profiles, and platform assets
          if (seenUrls.has(cleanUrl) ||
              cleanUrl.includes('profile') ||
              cleanUrl.includes('user') ||
              cleanUrl.includes('platform-assets')) {
            return;
          }

          // Get category from map or try to find it
          let category = categoryMap.get(cleanUrl) || '';

          // If no category found, check the image's container
          if (!category) {
            const container = img.closest('[role="group"], div[class*="slide"]');
            if (container) {
              const heading = container.querySelector('h3, h4');
              if (heading) {
                category = heading.textContent?.trim() || '';
              }
            }
          }

          // Don't filter here, we'll filter outside page.evaluate for better logging

          seenUrls.add(cleanUrl);
          allImages.push({
            url: cleanUrl + '?im_w=1200',
            alt: img.alt || '',
            category: category || 'interior',
            width: img.naturalWidth || img.width || null,
            height: img.naturalHeight || img.height || null
          });
        });

        console.log(`Categories found: ${Array.from(new Set(allImages.map(img => img.category)))}`);
      }

      // Fallback: get images from the page if modal wasn't found or no images extracted
      if (allImages.length === 0) {
        console.log('No modal found or no images in modal, using fallback...');
        document.querySelectorAll('img[src*="muscache.com"]').forEach(img => {
          const cleanUrl = img.src.split('?')[0];

          if (!seenUrls.has(cleanUrl) &&
              !cleanUrl.includes('profile') &&
              !cleanUrl.includes('user') &&
              !cleanUrl.includes('platform-assets')) {

            seenUrls.add(cleanUrl);
            allImages.push({
              url: cleanUrl + '?im_w=1200',
              alt: img.alt || '',
              category: 'interior',
              width: img.naturalWidth || img.width || null,
              height: img.naturalHeight || img.height || null
            });
          }
        });
      }

      return {
        images: allImages,
        skipped: []  // For debugging
      };
    });

    // Filter images based on keywords
    const filteredImages = imagesData.images.filter(img => {
      // Check both category and alt text for exterior keywords
      const exteriorKeywords = [
        'balcony', 'balcon', 'balcón', 'exterior', 'outdoor', 'outside',
        'patio', 'terrace', 'garden', 'yard', 'pool', 'view from',
        'street', 'building', 'neighbourhood', 'neighborhood',
        'entrance', 'façade', 'facade', 'roof', 'aerial', 'city view'
      ];

      const checkText = (img.category + ' ' + img.alt).toLowerCase();
      const isExterior = exteriorKeywords.some(keyword => checkText.includes(keyword));

      if (isExterior) {
        console.log(`Filtering out exterior image: ${img.category || img.alt}`);
      }

      return !isExterior;
    });

    const images = filteredImages;
    const title = await extractTitle(page);

    // Try to close the photo modal if it's open to get back to main page
    try {
      await page.keyboard.press('Escape');
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e) {
      // Modal might not be open, continue
    }

    await browser.close();

    // Get max images from override, environment variable, or default to 100
    const maxImages = maxImagesOverride || parseInt(process.env.MAX_IMAGES) || 100;
    console.log(`Limiting gallery to ${maxImages} images (found ${images.length} total)`);

    return {
      url,
      proxyUsed: useProxy || useBrightDataBrowser,
      data: {
        title,
        totalImages: images.length,
        gallery: images.slice(0, maxImages)
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