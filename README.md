# Airbnb Scraper API

A Node.js API that scrapes Airbnb listing gallery images with intelligent filtering and proxy support.

## Features

- Accepts any Airbnb domain (.com, .co.uk, etc.)
- Clicks "Show all photos" to access full gallery
- Filters out exterior/outdoor images automatically
- Configurable image limit via environment variable or API request
- Returns gallery images in JSON format
- Validates Airbnb URLs
- CORS enabled
- Proxy support (HTTP and BrightData Scraping Browser)

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file in the root directory with the following variables:

```env
# BrightData Proxy Configuration
PROXY_HOST=brd.superproxy.io
PROXY_PORT=9222
PROXY_USERNAME=your-username
PROXY_PASSWORD=your-password

# Server Configuration
PORT=3001

# Image Scraping Options
# Maximum number of images to scrape (default: 100)
MAX_IMAGES=50

# Proxy Options
# Set USE_PROXY=true to use regular HTTP proxy
# Set USE_BRIGHTDATA_BROWSER=true to use BrightData Scraping Browser (WebSocket)
# If both are false, direct connection will be used
USE_PROXY=false
USE_BRIGHTDATA_BROWSER=true
```

## Usage

Start the server:
```bash
npm start
```

The API will run on port 3001 by default.

### Endpoints

**Health Check**
```
GET /api/health
```

**Scrape Airbnb Listing**
```
POST /api/scrape
Content-Type: application/json

{
  "url": "https://www.airbnb.com/rooms/12345",
  "useProxy": false,  // optional: override proxy settings
  "maxImages": 10     // optional: override MAX_IMAGES from env
}
```

Response:
```json
{
  "success": true,
  "url": "https://www.airbnb.com/rooms/12345",
  "proxyUsed": false,
  "data": {
    "title": "Property Title",
    "totalImages": 25,
    "gallery": [
      {
        "url": "image_url",
        "alt": "Bedroom image 1",
        "category": "interior",
        "width": 1024,
        "height": 768
      }
    ]
  }
}
```

## Image Filtering

The scraper automatically filters out exterior/outdoor images by detecting keywords in image categories and alt text:
- Balcony, Patio, Terrace
- Garden, Yard, Pool
- Exterior, Outdoor, Outside
- Street, Building, Neighborhood
- Entrance, Facade, Roof

Only interior images are returned in the gallery.

## Image Limit

You can control the maximum number of images returned in three ways:

1. **Environment Variable**: Set `MAX_IMAGES` in `.env` file (default: 100)
2. **API Request**: Include `maxImages` in the request body
3. **Default**: If not specified, defaults to 100 images

The `totalImages` field shows how many images were found, while `gallery` contains the limited array.

## Testing

Run the test script:
```bash
npm test
```

## Example Usage

### Basic Request
```javascript
fetch('http://localhost:3001/api/scrape', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    url: 'https://www.airbnb.co.uk/rooms/20669368'
  })
})
.then(res => res.json())
.then(data => console.log(data));
```

### With Custom Image Limit
```javascript
fetch('http://localhost:3001/api/scrape', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    url: 'https://www.airbnb.co.uk/rooms/20669368',
    maxImages: 5
  })
})
.then(res => res.json())
.then(data => console.log(data));
```

### With Proxy Override
```javascript
fetch('http://localhost:3001/api/scrape', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    url: 'https://www.airbnb.co.uk/rooms/20669368',
    useProxy: true,
    maxImages: 10
  })
})
.then(res => res.json())
.then(data => console.log(data));
```