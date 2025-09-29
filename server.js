require('dotenv').config();
const express = require('express');
const cors = require('cors');
const scraper = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration (allow explicit origins and handle preflight)
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,https://isoview.app,https://www.isoview.app')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser tools (no Origin header)
    if (!origin) return callback(null, true);
    const isAllowed = allowedOrigins.includes(origin);
    return callback(isAllowed ? null : new Error('Not allowed by CORS'), isAllowed);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
  maxAge: 600
};

// Middleware
app.use(cors(corsOptions));
// Ensure preflight requests are handled for all routes
app.options('*', cors(corsOptions));
app.use(express.json());

// Routes
app.post('/api/scrape', async (req, res) => {
  console.log('\n🔍 [API HIT] POST /api/scrape');
  console.log('📋 Request Body:', JSON.stringify(req.body, null, 2));
  console.log('🕐 Timestamp:', new Date().toISOString());

  try {
    const { url, useProxy, maxImages } = req.body;

    // Validate input
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL is required'
      });
    }

    if (!scraper.validateAirbnbUrl(url)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Airbnb URL. Please provide a valid Airbnb listing URL.'
      });
    }

    // Override proxy setting if specified
    const proxyOverride = typeof useProxy === 'boolean' ? useProxy : undefined;

    // Validate maxImages if provided
    let maxImagesOverride = undefined;
    if (maxImages !== undefined) {
      const parsed = parseInt(maxImages);
      if (isNaN(parsed) || parsed < 1) {
        return res.status(400).json({
          success: false,
          error: 'Invalid maxImages value. Must be a positive integer.'
        });
      }
      maxImagesOverride = parsed;
    }

    // Scrape the listing
    console.log('🌐 Starting scrape for URL:', url);
    console.log('🔧 Using proxy:', proxyOverride !== undefined ? proxyOverride : 'default setting');
    if (maxImagesOverride) {
      console.log('📸 Max images override:', maxImagesOverride);
    }

    const result = await scraper.scrapeAirbnbListing(url, proxyOverride, maxImagesOverride);

    console.log('✅ Scrape completed successfully');
    console.log('📊 Result preview:', {
      title: result.data?.title?.substring(0, 50) + '...',
      price: result.data?.price,
      imagesCount: result.data?.images?.length || 0
    });

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('❌ [ERROR] Scrape failed:', error.message);
    console.error('Stack trace:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to scrape the listing',
      message: error.message
    });
  }
});

// Explicit preflight handler for scrape endpoint (defensive)
app.options('/api/scrape', cors(corsOptions));

app.get('/api/health', (req, res) => {
  console.log('\n💚 [API HIT] GET /api/health');
  console.log('🕐 Timestamp:', new Date().toISOString());

  const config = scraper.getProxyConfig();
  res.json({
    status: 'OK',
    message: 'Airbnb Scraper API is running',
    version: '1.0.0',
    proxy: config
  });
});

app.get('/', (req, res) => {
  console.log('\n🏠 [API HIT] GET /');
  console.log('🕐 Timestamp:', new Date().toISOString());

  res.json({
    message: 'Airbnb Scraper API',
    endpoints: {
      scrape: 'POST /api/scrape',
      health: 'GET /api/health'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: 'Something went wrong!'
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Airbnb Scraper API is running`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /api/scrape - Scrape Airbnb listing`);
  console.log(`  GET  /api/health - Check API status`);

  const config = scraper.getProxyConfig();
  if (config.enabled) {
    console.log(`\n🔒 Proxy: ${config.type} (${config.host || 'Configured'})`);
  } else {
    console.log(`\n🌐 Direct connection (no proxy)`);
  }
});

module.exports = app;