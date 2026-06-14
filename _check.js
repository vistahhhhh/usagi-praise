const fs = require('fs');
const path = `D:/PYTHONALL/自己随便搞搞/Usagi's Cyber Burrow The Sanctuary of Praise/usagi-praise/src/modules/praise-bubble.js`;
const buf = fs.readFileSync(path);
let bad = [];
for (let i = 0; i < buf.length; i++) {
  if (buf[i] < 0x20 && buf[i] !== 0x0a && buf[i] !== 0x0d && buf[i] !== 0x09) {
    bad.push(`${i}:0x${buf[i].toString(16)}`);
  }
}
console.log(`Bad chars: ${bad.length ? bad.join(',') : 'NONE'}`);
console.log(`Size: ${buf.length} bytes`);
console.log(`Last bytes: ${buf.slice(-10).toString('hex')}`);
console.log(`Start: ${buf.slice(0, 4).toString('hex')}`);

// Also check if it parses
try {
  new Function(buf.toString('utf-8'));
  console.log('JS PARSE: OK');
} catch(e) {
  console.log('JS PARSE FAIL:', e.message);
}
