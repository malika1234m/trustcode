// TrustCode demo (JS-D2-01). Task: Write isPalindrome(text) that returns true if text reads the same forwards and backwards, ignoring case and any non-alphanumeric characters.
// Select the code below and run: TrustCode: Verify Selected Code

function isPalindrome(text) {
  const s = text.toLowerCase();
  return s === s.split('').reverse().join('');
}

module.exports = { isPalindrome };
