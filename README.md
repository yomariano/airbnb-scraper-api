# Airbnb Scraper API

A Node.js API that scrapes Airbnb listing gallery images using browser-use.

## Features

- Accepts any Airbnb domain (.com, .co.uk, etc.)
- Returns gallery images in JSON format
- Validates Airbnb URLs
- CORS enabled

## Installation

```bash
npm install
```

## Usage

Start the server:
```bash
npm start
```

The API will run on port 3000 by default.

### Endpoints

**Health Check**
```
GET /health
```

**Scrape Airbnb Listing**
```
POST /scrape
Content-Type: application/json

{
  "url": "https://www.airbnb.com/rooms/12345"
}
```

Response:
```json
{
  "success": true,
  "url": "https://www.airbnb.com/rooms/12345",
  "data": {
    "title": "Property Title",
    "totalImages": 15,
    "gallery": [
      {
        "url": "image_url",
        "alt": "alt text",
        "width": 1024,
        "height": 768
      }
    ]
  }
}
```

## Testing

Run the test script:
```bash
npm test
```

## Example Usage

```javascript
fetch('http://localhost:3000/scrape', {
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