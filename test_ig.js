const axios = require("axios");
const cheerio = require("cheerio");

async function testIG() {
  const url = 'https://www.instagram.com/p/C0O1z33LK1b/';
  // Convert URL to embed URL
  let embedUrl = url;
  if (!url.includes('/embed')) {
    embedUrl = url.replace(/\/$/, '') + '/embed/captioned/';
  }
  try {
    const res = await axios.get(embedUrl);
    const $ = cheerio.load(res.data);
    const caption = $('.Caption').text();
    const title = $('title').text();
    console.log("Caption:", caption);
    console.log("Title:", title);
  } catch (err) {
    console.error("Error:", err.message);
  }
}
testIG();
