/* Compatibility module: sweep planning is deliberately pure and lives with book parsing. */
var PandaSweep = PandaSweep || {};
PandaSweep.plan = function (book, buy, amount, limit, block) {
  return PandaBook.plan(book, buy, amount, limit, block);
};
