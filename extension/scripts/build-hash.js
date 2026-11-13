// Prints the build hash of the compiled extension (out/src), in the form the server setting
// TRUSTCODE_LICENCE_KNOWN_BUILDS expects: "<version>=<sha256>". Run after `npm run compile`, at release time.
const path = require('path');
const { buildHash } = require('../out/src/licence/build');
const { version } = require('../package.json');
buildHash(path.join(__dirname, '..', 'out', 'src')).then((h) => {
  if (!h) { console.error('out/src has no compiled files: run "npm run compile" first'); process.exit(1); }
  console.log(`${version}=${h}`);
});
