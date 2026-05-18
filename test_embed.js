const axios = require('axios');
const cheerio = require('cheerio');
axios.get('https://www.instagram.com/p/DYPHhknICP1/embed/captioned/').then(r => {
    const $ = cheerio.load(r.data);
    const caption = $('.Caption').text() || $('.CaptionUsername').next().text() || $('div').text();
    console.log("Found text length:", caption.length);
    console.log(caption.substring(0, 500));
}).catch(console.error);
