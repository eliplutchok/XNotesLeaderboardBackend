const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

const port = process.env.PORT || 3000;

const tweetAuthorRoutes = require('./routes/tweetAuthorRoutes'); 

app.use('/api', tweetAuthorRoutes); // Adjusted to use a single base path

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

module.exports = app;
