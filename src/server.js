require('dotenv').config({ quiet: true });
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
createApp().listen(PORT, () => {
  console.log(`Student Learning App running at http://localhost:${PORT}`);
});
