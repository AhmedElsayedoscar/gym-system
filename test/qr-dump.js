const { makeQr } = require('../qr.js');
const samples = ['GYM-7K3Q9XZP', 'GYM-ABCDEFGH', 'A', 'x'.repeat(100), 'https://example.com/' + 'a'.repeat(150)];
const out = samples.map((t) => ({ text: t, ...makeQr(t) }));
process.stdout.write(JSON.stringify(out));
