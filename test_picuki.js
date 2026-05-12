const axios = require("axios");
const cheerio = require("cheerio");

async function testIG(url) {
  try {
    // Try scraping from an Instagram viewer like picuki
    const picukiUrl = url.replace("instagram.com", "picuki.com");
    console.log("Fetching:", picukiUrl);
    const res = await axios.get(picukiUrl, { 
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36" } 
    });
    const $ = cheerio.load(res.data);
    const caption = $('.single-photo-description').text() || $('meta[name="description"]').attr('content') || '';
    console.log("Extracted:", caption.substring(0, 500));
  } catch (err) {
    console.error("Error:", err.message);
  }
}

testIG("https://www.instagram.com/reel/DXv5dSKzV90/");
testIG("https://www.instagram.com/p/C0O1z33LK1b/");
