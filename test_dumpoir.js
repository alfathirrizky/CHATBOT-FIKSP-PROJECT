const axios = require('axios');
const cheerio = require('cheerio');
axios.get('https://dumpoir.com/v/DYPHhknICP1').then(r => {
    const $ = cheerio.load(r.data);
    $('script').each((i, el) => {
        const text = $(el).text();
        if (text) {
            console.log(text.substring(0, 100));
        }
    });
}).catch(console.error);
