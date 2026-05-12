const axios = require("axios");
const cheerio = require("cheerio");

async function test(url) {
  try {
    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      }
    });
    const $ = cheerio.load(res.data);
    const title = $("title").text() || $("meta[property='og:title']").attr("content");
    const desc = $("meta[property='og:description']").attr("content") || $("meta[name='description']").attr("content");
    const text = $("body").text().replace(/\s+/g, " ").substring(0, 1000);
    console.log("URL:", url);
    console.log("Title:", title);
    console.log("Desc:", desc);
    console.log("Text:", text);
    console.log("======================");
  } catch (err) {
    console.error("Error fetching", url, ":", err.message);
  }
}

test("https://www.instagram.com/p/C0O1z33LK1b/");
test("https://news.detik.com/berita/d-7334759/pemerintah-resmi-tetapkan-idul-adha-1445-h-jatuh-pada-17-juni-2024");
