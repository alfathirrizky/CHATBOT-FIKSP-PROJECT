const axios = require('axios');
const url = 'https://www.instagram.com/graphql/query/?query_hash=b3055c01b4b222b8a47dc12b090e4e64&variables={"shortcode":"DYPHhknICP1"}';
axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } })
  .then(r => console.log(r.data))
  .catch(e => console.error(e.response ? e.response.status : e.message));
