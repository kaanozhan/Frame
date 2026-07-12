/**
 * Entry point — wires the math helpers to the CLI.
 */

const { add, multiply } = require('./lib/mathUtils');

/**
 * Format a greeting with a computed sum
 */
function greet(name) {
  return `Hello, ${name}! 2+3=${add(2, 3)}`;
}

/**
 * Run the app
 */
function run() {
  console.log(greet('world'));
  console.log(multiply(3, 4));
}

module.exports = { greet, run };
